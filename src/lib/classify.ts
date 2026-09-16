import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { SourceKind } from "@prisma/client";

/**
 * Files records the keyword rules could not place.
 *
 * Three rules keep this safe to run unattended:
 *  1. It only reads items sitting in the Unassigned bucket. A division a person
 *     chose is never touched.
 *  2. Low confidence means it leaves the item where it is. A wrong division is
 *     worse than an honest blank, because a wrong one looks filed.
 *  3. It writes its reasoning into the record, so a bad call can be seen and
 *     corrected rather than argued about.
 */

const DIVISION_BRIEF = `
up   — Upstream. Exploration and production. Well construction and integrity, hydraulic
       fracturing, produced water, methane and other production emissions, flaring at the
       wellsite, federal and state leasing, royalties, bonding, offshore development,
       orphan wells, setbacks, air permits for production sites.

mid  — Midstream. Everything between the wellhead and the plant gate. Transmission and
       gathering pipelines, compressor stations, pipeline safety and integrity management,
       leak detection and repair on pipelines, class locations, underground gas storage,
       LNG import and export terminals as facilities, pipeline certificates and siting.

down — Downstream. Refining and fuels. Refinery process units, flares at refineries,
       process safety management, fuel standards and specifications, renewable fuel
       volumes, petrochemicals, storage tanks and terminals, marketing and distribution.

gas  — Natural Gas Markets. Commodity and market structure. LNG export authorizations as
       trade decisions, gas-electric coordination, capacity release, nominations and
       scheduling, wholesale market rules and manipulation, derivatives and position
       limits, storage and price reporting.

corp — Corporate Policy. Cross-cutting business regulation that is not specific to one
       segment. Tax and credits, trade and tariffs, securities and climate disclosure,
       permitting reform and NEPA process, judicial review, corporate governance,
       workforce rules that apply company-wide.
`.trim();

const Result = z.object({
  results: z.array(
    z.object({
      docket: z.string().describe("copied exactly from the input"),
      division: z.enum(["up", "mid", "down", "gas", "corp", "none"])
        .describe("use none when no division is a clear fit"),
      confidence: z.enum(["high", "medium", "low"]),
      reason: z.string().describe("one short sentence, the evidence you used"),
    })
  ),
});

type Candidate = { id: string; docket: string; title: string; agency: string; topics: string[] };

async function classifyBatch(client: Anthropic, batch: Candidate[]) {
  const lines = batch
    .map((c, i) => `${i + 1}. docket: ${c.docket}\n   agency: ${c.agency}\n   title: ${c.title}`)
    .join("\n");

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 8000,
    output_config: { effort: "low", format: zodOutputFormat(Result) },
    system:
      "You file United States federal regulatory documents into the policy divisions of an " +
      "energy trade association. You are filing work, not summarising it. When a document " +
      "does not clearly belong to one division, answer none — an honest blank is better than " +
      "a wrong file, because a wrong file looks handled and nobody checks it again.",
    messages: [
      {
        role: "user",
        content:
          `The divisions:\n\n${DIVISION_BRIEF}\n\n` +
          `File each document below. Return one result per document, with the docket copied ` +
          `exactly.\n\nUse low confidence when the title is too thin to judge, and none when no ` +
          `division fits. A document about electricity reliability, drinking water, pesticides ` +
          `or another industry belongs to none.\n\n${lines}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("the model declined this batch");
  return response.parsed_output?.results ?? [];
}

export async function classifyUnassigned(limit = 200, batchSize = 12) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic();

  const candidates = await prisma.item.findMany({
    where: { divisionId: "none" },
    orderBy: [{ commentDueAt: "asc" }, { createdAt: "desc" }],
    take: limit,
    select: { id: true, docket: true, title: true, agency: true, topics: true },
  });

  const run = await prisma.agentRun.create({ data: { source: SourceKind.MANUAL } });
  let filed = 0, leftAlone = 0, checked = 0;

  try {
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      const results = await classifyBatch(client, batch);
      checked += batch.length;

      for (const r of results) {
        const item = batch.find((c) => c.docket === r.docket);
        if (!item) continue;

        if (r.division === "none" || r.confidence === "low") {
          leftAlone++;
          continue;
        }
        // Re-read: a person may have filed this item while the batch was in flight.
        const fresh = await prisma.item.findUnique({ where: { id: item.id }, select: { divisionId: true } });
        if (!fresh || fresh.divisionId !== "none") { leftAlone++; continue; }

        await prisma.$transaction([
          prisma.item.update({ where: { id: item.id }, data: { divisionId: r.division } }),
          prisma.audit.create({
            data: { itemId: item.id, actor: "classifier", field: "division",
                    fromValue: "Unassigned", toValue: r.division },
          }),
          prisma.finding.create({
            data: { itemId: item.id, source: SourceKind.MANUAL,
                    summary: `Filed by the classifier, ${r.confidence} confidence. ${r.reason}` },
          }),
        ]);
        filed++;
      }
    }
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: true, checked, changed: filed, created: 0 },
    });
    return { checked, filed, leftAlone };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, checked, changed: filed, error: message },
    });
    throw err;
  }
}
