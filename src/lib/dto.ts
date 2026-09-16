import { prisma } from "@/lib/prisma";

export type ItemDTO = {
  id: string; docket: string; title: string; agency: string; unit: string | null;
  track: string; stage: string; stageIndex: number;
  nextLabel: string | null;
  /** Days until comments close. Negative once the window has shut. */
  days: number | null;
  /** Derived from the date on every read, never from a stored flag. */
  isOpen: boolean;
  divisionId: string; ownerId: string | null; ownerName: string | null;
  priority: string; priorityConfirmed: boolean;
  position: string; positionNote: string | null;
  positionSetBy: string | null; positionSetAt: string | null;
  topics: string[]; standards: string[]; draftState: string | null;
  sourceUrl: string | null; frCitation: string | null; abstract: string | null;
  commentCount: number | null;
  recentCommenters: { submitter: string; postedDate: string; title: string }[] | null;
  lastFinding: { summary: string; source: string; foundAt: string } | null;
};
export type PersonDTO = { id: string; name: string; divisionId: string };
export type DivisionDTO = { id: string; name: string; colorVar: string };
export type AuditDTO = { id: string; itemId: string | null; actor: string; field: string; fromValue: string | null; toValue: string | null; at: string };
export type RunDTO = { source: string; startedAt: string; finishedAt: string | null; ok: boolean; checked: number; created: number; changed: number; error: string | null };

/**
 * Days until a comment window closes. Negative after it has shut.
 *
 * This used to clamp at zero, which made a window that closed yesterday read as
 * "1 day left" and kept it shouting in the 48-hour band for ever.
 */
const daysUntil = (d: Date | null) =>
  d === null ? null : Math.ceil((d.getTime() - Date.now()) / 86400000);

export async function loadDashboard() {
  const [divisions, people, items, audits, runs] = await Promise.all([
    prisma.division.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.person.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.item.findMany({
      where: { archivedAt: null },
      include: {
        owner: true,
        findings: { orderBy: { foundAt: "desc" }, take: 1 },
      },
      orderBy: [{ commentDueAt: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.audit.findMany({ orderBy: { at: "desc" }, take: 400 }),
    prisma.agentRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
  ]);

  // Actions per month by division, for the column chart. Twelve months back.
  const from = new Date(); from.setMonth(from.getMonth() - 11); from.setDate(1);
  const monthly: Record<string, Record<string, number>> = {};
  for (const i of items) {
    const when = i.publishedOn ?? i.createdAt;
    if (when < from) continue;
    const key = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
    (monthly[key] ??= {})[i.divisionId] = ((monthly[key] ??= {})[i.divisionId] ?? 0) + 1;
  }

  return {
    divisions: divisions.map((d): DivisionDTO => ({ id: d.id, name: d.name, colorVar: d.colorVar })),
    people: people.map((p): PersonDTO => ({ id: p.id, name: p.name, divisionId: p.divisionId })),
    items: items.map((i): ItemDTO => ({
      id: i.id, docket: i.docket, title: i.title, agency: i.agency, unit: i.unit,
      track: i.track, stage: i.stage, stageIndex: i.stageIndex,
      nextLabel: i.nextLabel,
      days: daysUntil(i.commentDueAt),
      isOpen: i.commentDueAt !== null && i.commentDueAt.getTime() >= Date.now(),
      divisionId: i.divisionId, ownerId: i.ownerId, ownerName: i.owner?.name ?? null,
      priority: i.priority, priorityConfirmed: i.priorityConfirmed,
      position: i.position, positionNote: i.positionNote,
      positionSetBy: i.positionSetBy,
      positionSetAt: i.positionSetAt?.toISOString() ?? null,
      topics: i.topics, standards: i.standards, draftState: i.draftState,
      sourceUrl: i.sourceUrl, frCitation: i.frCitation, abstract: i.abstract,
      commentCount: i.commentCount,
      recentCommenters: (i.recentCommenters as ItemDTO["recentCommenters"]) ?? null,
      lastFinding: i.findings[0]
        ? { summary: i.findings[0].summary, source: i.findings[0].source, foundAt: i.findings[0].foundAt.toISOString() }
        : null,
    })),
    audits: audits.map((a): AuditDTO => ({
      id: a.id, itemId: a.itemId, actor: a.actor, field: a.field,
      fromValue: a.fromValue, toValue: a.toValue, at: a.at.toISOString(),
    })),
    monthly,
    runs: runs.map((r): RunDTO => ({
      source: r.source, startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      ok: r.ok, checked: r.checked, created: r.created, changed: r.changed, error: r.error,
    })),
  };
}
export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;
