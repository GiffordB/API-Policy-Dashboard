import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { Priority, SourceKind } from "@prisma/client";

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

type Candidate = {
  id: string; docket: string; title: string; agency: string;
  topics: string[]; abstract: string | null;
};

async function classifyBatch(client: Anthropic, batch: Candidate[]) {
  const lines = batch
    .map((c, i) =>
      `${i + 1}. docket: ${c.docket}\n   agency: ${c.agency}\n   title: ${c.title}` +
      (c.abstract ? `\n   summary: ${c.abstract.slice(0, 700)}` : ""))
    .join("\n\n");

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 8000,
    output_config: { effort: "low", format: zodOutputFormat(Result) },
    system:
      "You file United States federal regulatory documents into the policy divisions of an " +
      "oil and natural gas trade association. You are filing work, not summarising it.\n\n" +
      "These documents were already filtered to agencies the association follows, so most of " +
      "them do belong to one of the five divisions. File them. Reserve none for a document " +
      "that genuinely concerns another industry — electric reliability, drinking water, " +
      "pesticides, food, aviation — or that is pure agency housekeeping.\n\n" +
      "Judge by subject matter, not by which agency published it. EPA publishes for every " +
      "division. A state air quality plan that governs production sites is upstream; one that " +
      "governs refineries is downstream. When two divisions could argue for it, pick the one " +
      "whose members the rule binds, and say so in your reason.",
    messages: [
      {
        role: "user",
        content:
          `The divisions:\n\n${DIVISION_BRIEF}\n\n` +
          `File each document below. Return one result per document, with the docket copied ` +
          `exactly.\n\nConfidence means how sure you are of the division, not how important the ` +
          `document is. A routine rule you can place from its title is high confidence. Use low ` +
          `only when you genuinely cannot tell which of two or more divisions owns it.\n\n${lines}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("the model declined this batch");
  return response.parsed_output?.results ?? [];
}

export type Decision = {
  docket: string; title: string; division: string; confidence: string; reason: string; applied: boolean;
};

export async function classifyUnassigned(limit = 200, batchSize = 12, dryRun = false, recheck = false) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic();

  const candidates = await prisma.item.findMany({
    where: recheck ? { divisionId: "none" } : { divisionId: "none", classifiedAt: null },
    orderBy: [{ commentDueAt: "asc" }, { createdAt: "desc" }],
    take: limit,
    select: { id: true, docket: true, title: true, agency: true, topics: true, abstract: true },
  });

  const run = dryRun ? null : await prisma.agentRun.create({ data: { source: SourceKind.MANUAL } });
  let filed = 0, leftAlone = 0, ghosted = 0, checked = 0;
  const decisions: Decision[] = [];

  try {
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      const results = await classifyBatch(client, batch);
      checked += batch.length;

      for (const r of results) {
        const item = batch.find((c) => c.docket === r.docket);
        if (!item) continue;

        // A confident "none" is a judgement, not a shrug: this is not the
        // association's work. Ghost it, using the same flag a person would.
        // An unsure "none" stays in Unassigned for a human to look at.
        const ghost = r.division === "none" && r.confidence === "high";
        const skip = r.division === "none" || r.confidence === "low";
        decisions.push({
          docket: r.docket, title: item.title.slice(0, 110),
          division: r.division, confidence: r.confidence, reason: r.reason,
          applied: (!skip || ghost) && !dryRun,
        });
        if (dryRun) { leftAlone++; continue; }

        if (ghost) {
          const fresh = await prisma.item.findUnique({
            where: { id: item.id }, select: { divisionId: true, priority: true },
          });
          // Never override a priority a person set.
          if (!fresh || fresh.divisionId !== "none" || fresh.priority !== Priority.MEDIUM) {
            await prisma.item.update({ where: { id: item.id }, data: { classifiedAt: new Date() } });
            leftAlone++;
            continue;
          }
          await prisma.$transaction([
            prisma.item.update({
              where: { id: item.id },
              data: { priority: Priority.NOT_RELEVANT, priorityConfirmed: false, classifiedAt: new Date() },
            }),
            prisma.audit.create({
              data: { itemId: item.id, actor: "classifier", field: "priority",
                      fromValue: "Medium", toValue: "Not relevant" },
            }),
            prisma.finding.create({
              data: { itemId: item.id, source: SourceKind.MANUAL,
                      summary: `Marked not relevant by the classifier. ${r.reason} Set a priority to bring it back.` },
            }),
          ]);
          ghosted++;
          continue;
        }

        if (skip) {
          await prisma.item.update({ where: { id: item.id }, data: { classifiedAt: new Date() } });
          leftAlone++;
          continue;
        }
        // Re-read: a person may have filed this item while the batch was in flight.
        const fresh = await prisma.item.findUnique({ where: { id: item.id }, select: { divisionId: true } });
        if (!fresh || fresh.divisionId !== "none") { leftAlone++; continue; }

        await prisma.$transaction([
          prisma.item.update({
            where: { id: item.id },
            data: { divisionId: r.division, classifiedAt: new Date() },
          }),
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
    if (run) await prisma.agentRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: true, checked, changed: filed, created: 0 },
    });
    return { dryRun, checked, filed, ghosted, leftAlone, decisions };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) await prisma.agentRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, checked, changed: filed, error: message },
    });
    throw err;
  }
}
