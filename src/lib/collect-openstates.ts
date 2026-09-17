import { prisma } from "@/lib/prisma";
import { Priority, SourceKind, Track, WatchKind } from "@prisma/client";
import { searchBills, billId, stageFor, type StateBill } from "@/lib/sources/openstates";
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

/**
 * State bills matching the watchlist's terms.
 *
 * Open States searches every state at once, so this costs one request per term
 * rather than one per state. The JURISDICTION entries on the coverage page then
 * decide which states are kept — a national search narrowed to the states you
 * work, rather than fifty searches you cannot afford.
 *
 * With no jurisdictions on the list, every state is kept. That is the honest
 * default: better a wide net you can see than a silent filter.
 */
export async function collectOpenStates(sinceDays = 7) {
  const actionSince = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const run = await prisma.agentRun.create({ data: { source: SourceKind.OPEN_STATES } });
  let checked = 0, created = 0, changed = 0, skipped = 0;

  try {
    const terms = await prisma.watch.findMany({ where: { active: true, kind: WatchKind.TERM } });
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

    for (const term of terms) {
      const bills = await searchBills(term.value, actionSince);
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

    const now = new Date();
    for (const [id, n] of hits) {
      await prisma.watch.update({
        where: { id },
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
