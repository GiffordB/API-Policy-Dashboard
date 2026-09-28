import { prisma } from "@/lib/prisma";
import { WatchKind } from "@prisma/client";

/**
 * Dockets a person said do not track.
 *
 * "Not relevant" ghosts a record: it stays in the database, stays in the
 * counts, and every collector run still reads and updates it. "Do not track"
 * deletes it. That only stays true if something remembers the decision —
 * otherwise the next run finds the same Federal Register document and puts it
 * straight back.
 *
 * The memory is a watchlist row of kind BLOCK, holding the docket. It costs a
 * few dozen bytes in place of a full record with its abstract and snapshots,
 * and it appears on the coverage page beside everything else we do and do not
 * look for, so a removal is visible rather than folklore.
 *
 * Switching that row off (or a direct add of the same docket) lifts the block.
 */

/** Every blocked docket, for a collector run to check against in memory. */
export async function blockedDockets(): Promise<Set<string>> {
  const rows = await prisma.watch.findMany({
    where: { kind: WatchKind.BLOCK, active: true },
    select: { value: true },
  });
  return new Set(rows.map((r) => r.value));
}

/** The live block on one docket, or null. */
export function blockOn(docket: string) {
  return prisma.watch.findFirst({ where: { kind: WatchKind.BLOCK, value: docket, active: true } });
}

/**
 * Lifts the block on a docket, if there is one, and says whether there was.
 *
 * The row is switched off rather than deleted, so the coverage page keeps the
 * record of a docket that was removed and then brought back.
 */
export async function liftBlock(docket: string, actor: string): Promise<boolean> {
  const block = await blockOn(docket);
  if (!block) return false;
  await prisma.$transaction([
    prisma.watch.update({ where: { id: block.id }, data: { active: false } }),
    prisma.audit.create({
      data: {
        actor, field: "tracking",
        fromValue: `${docket} — do not track`,
        toValue: "tracked again, added by hand",
      },
    }),
  ]);
  return true;
}
