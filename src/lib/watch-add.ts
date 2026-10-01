import { prisma } from "@/lib/prisma";
import { SourceKind, WatchKind } from "@prisma/client";

/**
 * Putting things on the watchlist from somewhere other than the coverage page.
 *
 * Tracking a record by hand used to store a row and stop there: nothing told
 * the collectors to read that docket again, so the record a person had just
 * said they cared about went stale from the moment it was saved. These are the
 * two entries that fix it — the docket, and optionally the agency behind it.
 *
 * Both are upserts that reactivate a paused entry rather than colliding with
 * it, so adding something twice is harmless.
 */

type Added = { id: string; created: boolean; resumed: boolean };

async function put(
  kind: WatchKind, value: string, label: string,
  { actor, note, source, divisionId }:
    { actor: string; note?: string; source?: SourceKind; divisionId?: string | null },
): Promise<Added> {
  const existing = await prisma.watch.findUnique({ where: { kind_value: { kind, value } } });
  if (existing) {
    if (existing.active) return { id: existing.id, created: false, resumed: false };
    await prisma.watch.update({ where: { id: existing.id }, data: { active: true, addedBy: actor } });
    return { id: existing.id, created: false, resumed: true };
  }
  const w = await prisma.watch.create({
    data: {
      kind, value, label,
      note: note ?? null,
      source: source ?? SourceKind.FEDERAL_REGISTER,
      divisionId: divisionId ?? null,
      addedBy: actor,
    },
  });
  return { id: w.id, created: true, resumed: false };
}

/** Follow this docket on every run, whatever its documents end up being called. */
export function pinDocket(
  docket: string, label: string,
  opts: { actor: string; source?: SourceKind; divisionId?: string | null },
) {
  return put(WatchKind.DOCKET, docket, label.slice(0, 160), {
    ...opts,
    note: "Pinned when the record was added by hand.",
  });
}

/** Sweep everything this agency publishes. A slug, not a name — see fetchAgencies. */
export function sweepAgency(
  slug: string, label: string,
  opts: { actor: string; note?: string; divisionId?: string | null },
) {
  return put(WatchKind.AGENCY, slug, label, { source: SourceKind.FEDERAL_REGISTER, ...opts });
}
