import { prisma } from "@/lib/prisma";
import { Priority, SourceKind, Track, WatchKind } from "@prisma/client";
import {
  fetchRecentBills, billId, stageFor, publicUrl, type CongressBill,
} from "@/lib/sources/congress";
import { inferDivision, inferTopics } from "@/lib/routing";

type Snapshot = { title: string; stage: string; action: string | null; actionDate: string | null };

const snapshotOf = (b: CongressBill, stage: string): Snapshot => ({
  title: b.title, stage,
  action: b.latestAction?.text ?? null,
  actionDate: b.latestAction?.actionDate ?? null,
});

function diff(before: Snapshot, after: Snapshot): string[] {
  const out: string[] = [];
  if (before.stage !== after.stage) out.push(`Moved from ${before.stage} to ${after.stage}.`);
  if (before.action !== after.action && after.action) out.push(`Latest action: ${after.action}`);
  if (before.title !== after.title) out.push("Title changed.");
  return out;
}

/**
 * Bills the watchlist's terms match.
 *
 * Congress.gov has no keyword search, so this pulls everything that changed and
 * matches titles here. That means a bill is only found if its *title* carries
 * the words — a bill about pipelines called "the Energy Freedom Act" is
 * invisible, and no amount of terms will fix that. Pinning it by number on the
 * coverage page will.
 */
export async function collectCongress(sinceDays = 3) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
  const run = await prisma.agentRun.create({ data: { source: SourceKind.CONGRESS_GOV } });
  let checked = 0, created = 0, changed = 0, skipped = 0;

  try {
    // Terms are not tied to one source: a phrase worth watching is worth
    // watching everywhere it can appear.
    const terms = await prisma.watch.findMany({ where: { active: true, kind: WatchKind.TERM } });
    const pins = await prisma.watch.findMany({
      where: { active: true, kind: WatchKind.DOCKET, source: SourceKind.CONGRESS_GOV },
    });
    if (!terms.length && !pins.length) {
      await prisma.agentRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), ok: true, checked: 0, created: 0, changed: 0 },
      });
      return { ok: true, checked: 0, created: 0, changed: 0, skipped: 0, note: "no terms on the watchlist" };
    }

    const bills = await fetchRecentBills(since);
    checked = bills.length;
    const hits = new Map<string, number>();

    for (const b of bills) {
      if (!b.title) continue;
      const hay = b.title.toLowerCase();
      const term = terms.find((t) => hay.includes(t.value.toLowerCase()));
      const pinned = pins.find((p) => billId(b).toLowerCase().includes(p.value.toLowerCase()));
      const watch = pinned ?? term;
      if (!watch) continue;

      hits.set(watch.id, (hits.get(watch.id) ?? 0) + 1);

      const docket = billId(b);
      const { stage, stageIndex } = stageFor(b);
      const snap = snapshotOf(b, stage);
      const nextLabel = b.latestAction
        ? `${b.latestAction.text.slice(0, 90)} (${b.latestAction.actionDate})`
        : "No action recorded";

      const existing = await prisma.item.findUnique({ where: { docket } });

      if (!existing) {
        const { division, confident } = inferDivision("", b.title, null);
        const item = await prisma.item.create({
          data: {
            docket, title: b.title,
            agency: b.originChamber ?? "Congress",
            unit: b.latestAction?.text?.slice(0, 120) ?? null,
            track: Track.CONGRESS, stage, stageIndex,
            nextLabel,
            divisionId: division,
            priority: Priority.MEDIUM, priorityConfirmed: false,
            topics: inferTopics(b.title, null),
            publishedOn: b.latestAction?.actionDate ? new Date(b.latestAction.actionDate) : null,
            source: SourceKind.CONGRESS_GOV,
            sourceUrl: publicUrl(b),
            foundByWatchId: watch.id,
            lastSnapshot: snap as object,
            lastSeenAt: new Date(),
          },
        });
        await prisma.finding.create({
          data: {
            itemId: item.id, source: SourceKind.CONGRESS_GOV,
            summary: confident
              ? `New bill matching “${watch.label}”. ${b.latestAction?.text ?? ""}`.trim()
              : `New bill matching “${watch.label}”. The division is a guess — please confirm it.`,
            detail: snap as object,
          },
        });
        created++;
        continue;
      }

      const before = (existing.lastSnapshot ?? null) as Snapshot | null;
      const lines = before ? diff(before, snap) : [];
      if (lines.length) {
        await prisma.finding.create({
          data: {
            itemId: existing.id, source: SourceKind.CONGRESS_GOV,
            summary: lines.join(" "), detail: { before, after: snap } as object,
          },
        });
        changed++;
      } else skipped++;

      await prisma.item.update({
        where: { id: existing.id },
        data: {
          title: b.title, stage, stageIndex, nextLabel,
          unit: b.latestAction?.text?.slice(0, 120) ?? existing.unit,
          sourceUrl: publicUrl(b),
          lastSnapshot: snap as object, lastSeenAt: new Date(),
        },
      });
    }

    const now = new Date();
    for (const w of [...terms, ...pins]) {
      const n = hits.get(w.id) ?? 0;
      if (!n) continue;   // a term that found nothing here may have found plenty elsewhere
      await prisma.watch.update({
        where: { id: w.id },
        data: { lastRunAt: now, lastHits: n, totalHits: { increment: n } },
      });
    }

    await prisma.agentRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: true, checked, created, changed },
    });
    return { ok: true, checked, created, changed, skipped };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, checked, created, changed, error: message },
    });
    throw err;
  }
}
