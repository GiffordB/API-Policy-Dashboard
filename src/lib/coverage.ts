import { prisma } from "@/lib/prisma";

export type WatchDTO = {
  id: string; kind: string; value: string; label: string; note: string | null;
  divisionId: string | null; active: boolean; addedBy: string;
  lastRunAt: string | null; lastHits: number; totalHits: number; found: number;
};

export async function loadCoverage() {
  const [divisions, watches, foundCounts, lastRun, totalItems] = await Promise.all([
    prisma.division.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.watch.findMany({ orderBy: [{ kind: "asc" }, { label: "asc" }] }),
    prisma.item.groupBy({ by: ["foundByWatchId"], _count: true }),
    prisma.agentRun.findFirst({ where: { ok: true }, orderBy: { startedAt: "desc" } }),
    prisma.item.count(),
  ]);

  const found = Object.fromEntries(
    foundCounts.filter((f) => f.foundByWatchId).map((f) => [f.foundByWatchId as string, f._count])
  );

  return {
    divisions: divisions.map((d) => ({ id: d.id, name: d.name, colorVar: d.colorVar })),
    watches: watches.map((w): WatchDTO => ({
      id: w.id, kind: w.kind, value: w.value, label: w.label, note: w.note,
      divisionId: w.divisionId, active: w.active, addedBy: w.addedBy,
      lastRunAt: w.lastRunAt?.toISOString() ?? null,
      lastHits: w.lastHits, totalHits: w.totalHits, found: found[w.id] ?? 0,
    })),
    lastRun: lastRun
      ? { at: lastRun.startedAt.toISOString(), checked: lastRun.checked, created: lastRun.created, changed: lastRun.changed }
      : null,
    totalItems,
    untraced: totalItems - Object.values(found).reduce((a, b) => a + b, 0),
  };
}
export type CoverageData = Awaited<ReturnType<typeof loadCoverage>>;
