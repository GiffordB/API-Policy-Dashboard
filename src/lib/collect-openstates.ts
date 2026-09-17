import { prisma } from "@/lib/prisma";
import { Priority, SourceKind, Track, WatchKind } from "@prisma/client";
import { searchBills, billId, stageFor, RateLimited, type StateBill } from "@/lib/sources/openstates";
import { inferDivision, inferTopics } from "@/lib/routing";

type Snapshot = { title: string; stage: string; action: string | null; actionDate: string | null };

const snapshotOf = (b: StateBill, stage: string): Snapshot => ({
  title: b.title, stage,
  action: b.latest_action_description ?? null,
  actionDate: b.latest_action_date ?? null,
});

function diff(before: Snapshot, after: Snapshot): string[] {
  const out: string[] = [];
  if (before.stage !== after.stage) out.push(`Moved from ${before.stage} to ${after.stage}.`);
  if (before.action !== after.action && after.action) out.push(`Latest action: ${after.action}`);
  if (before.title !== after.title) out.push("Title changed.");
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * State bills matching the watchlist's terms.
 *
 * Open States searches every state at once, so a term costs one request rather
 * than fifty. The JURISDICTION entries on the coverage page then decide which
 * states are kept. With none listed, every state is kept — a wide net you can
 * see beats a silent filter.
 *
 * The free key allows roughly ten requests a minute, which is the real
 * constraint. So a run does not try to sweep every term: it takes the terms
 * least recently swept, paces itself under the limit, and stops when its
 * request or time budget runs out. Each run advances the queue, and over a few
 * days every term comes round. Hitting the limit ends the run cleanly with
 * whatever it found, rather than throwing the work away.
 */
export async function collectOpenStates(
  sinceDays = 7,
  { maxRequests = 8, maxMillis = 45_000, pauseMillis = 6_500 } = {}
) {
  const actionSince = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const run = await prisma.agentRun.create({ data: { source: SourceKind.OPEN_STATES } });
  let checked = 0, created = 0, changed = 0, skipped = 0;

  try {
    const terms = await prisma.watch.findMany({
      where: { active: true, kind: WatchKind.TERM },
      orderBy: { lastRunAt: { sort: "asc", nulls: "first" } },   // round-robin across runs
      take: maxRequests,
    });
    const jurisdictions = await prisma.watch.findMany({
      where: { active: true, kind: WatchKind.JURISDICTION },
    });
    const wanted = new Set(jurisdictions.map((j) => j.value.toLowerCase()));

    if (!terms.length) {
      await prisma.agentRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), ok: true, checked: 0, created: 0, changed: 0 },
      });
      return { ok: true, checked: 0, created: 0, changed: 0, skipped: 0, note: "no terms on the watchlist" };
    }

    const hits = new Map<string, number>();
    const seen = new Set<string>();
    const startedAt = Date.now();
    const swept: string[] = [];
    let limited = false;

    for (const [n, term] of terms.entries()) {
      if (Date.now() - startedAt > maxMillis) break;
      if (n > 0) await sleep(pauseMillis);          // stay under ten a minute

      let bills: StateBill[];
      try {
        bills = await searchBills(term.value, actionSince);
      } catch (e) {
        if (e instanceof RateLimited) { limited = true; break; }
        throw e;
      }
      swept.push(term.label);
      for (const b of bills) {
        checked++;
        const where = b.jurisdiction?.name ?? "";
        if (wanted.size && !wanted.has(where.toLowerCase())) { skipped++; continue; }

        const docket = billId(b);
        if (seen.has(docket)) continue;
        seen.add(docket);
        hits.set(term.id, (hits.get(term.id) ?? 0) + 1);

        const { stage, stageIndex } = stageFor(b);
        const snap = snapshotOf(b, stage);
        const nextLabel = b.latest_action_description
          ? `${b.latest_action_description.slice(0, 90)}${b.latest_action_date ? ` (${b.latest_action_date})` : ""}`
          : "No action recorded";

        const existing = await prisma.item.findUnique({ where: { docket } });

        if (!existing) {
          const { division, confident } = inferDivision("", b.title, (b.subject ?? []).join(" "));
          const item = await prisma.item.create({
            data: {
              docket, title: b.title,
              agency: where || "State",
              unit: b.from_organization?.name ?? b.session,
              track: Track.STATE, stage, stageIndex,
              nextLabel,
              divisionId: division,
              priority: Priority.MEDIUM, priorityConfirmed: false,
              topics: inferTopics(b.title, (b.subject ?? []).join(" ")),
              publishedOn: b.latest_action_date ? new Date(b.latest_action_date) : null,
              source: SourceKind.OPEN_STATES,
              sourceUrl: b.openstates_url ?? null,
              foundByWatchId: term.id,
              lastSnapshot: snap as object,
              lastSeenAt: new Date(),
            },
          });
          await prisma.finding.create({
            data: {
              itemId: item.id, source: SourceKind.OPEN_STATES,
              summary: confident
                ? `New ${where} bill matching “${term.label}”. ${b.latest_action_description ?? ""}`.trim()
                : `New ${where} bill matching “${term.label}”. The division is a guess — please confirm it.`,
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
              itemId: existing.id, source: SourceKind.OPEN_STATES,
              summary: lines.join(" "), detail: { before, after: snap } as object,
            },
          });
          changed++;
        } else skipped++;

        await prisma.item.update({
          where: { id: existing.id },
          data: {
            title: b.title, stage, stageIndex, nextLabel,
            sourceUrl: b.openstates_url ?? existing.sourceUrl,
            lastSnapshot: snap as object, lastSeenAt: new Date(),
          },
        });
      }
    }

    // Every term actually swept moves to the back of the queue, whether or not
    // it found anything — otherwise a barren term is retried for ever.
    const now = new Date();
    for (const term of terms) {
      if (!swept.includes(term.label)) continue;
      const n = hits.get(term.id) ?? 0;
      await prisma.watch.update({
        where: { id: term.id },
        data: { lastRunAt: now, lastHits: n, totalHits: { increment: n } },
      });
    }

    const waiting = await prisma.watch.count({
      where: { active: true, kind: WatchKind.TERM, OR: [{ lastRunAt: null }, { lastRunAt: { lt: now } }] },
    });

    await prisma.agentRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: true, checked, created, changed },
    });
    return {
      ok: true, checked, created, changed, skipped,
      termsSwept: swept.length,
      note: limited
        ? `Stopped at the rate limit after ${swept.length} terms. ${waiting} still queued; the next run continues.`
        : `Swept ${swept.length} terms. ${waiting} queued for the next run.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, checked, created, changed, error: message },
    });
    throw err;
  }
}
