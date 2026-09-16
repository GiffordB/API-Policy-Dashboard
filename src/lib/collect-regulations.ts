import { prisma } from "@/lib/prisma";
import { SourceKind } from "@prisma/client";
import { fetchCommentSummary, DOCKET_PATTERN } from "@/lib/sources/regulations";

/**
 * Refreshes how many comments have been filed on the dockets you track.
 *
 * Rationing matters here: the key allows a few hundred requests an hour and
 * this costs one per docket. So a run takes the dockets that matter most —
 * an open window, closest deadline first, least recently checked — and stops
 * at a cap rather than emptying the budget on records nobody is watching.
 */
export async function collectRegulations(maxDockets = 40) {
  const run = await prisma.agentRun.create({ data: { source: SourceKind.REGULATIONS_GOV } });
  let checked = 0, changed = 0, skipped = 0;

  try {
    const candidates = await prisma.item.findMany({
      where: {
        archivedAt: null,
        commentDueAt: { gte: new Date() },       // the window is still open
      },
      orderBy: [{ commentsCheckedAt: { sort: "asc", nulls: "first" } }, { commentDueAt: "asc" }],
      take: maxDockets * 2,                       // some will not be Regulations.gov dockets
      select: { id: true, docket: true, title: true, commentCount: true },
    });

    for (const item of candidates) {
      if (checked >= maxDockets) break;
      if (!DOCKET_PATTERN.test(item.docket)) { skipped++; continue; }

      const summary = await fetchCommentSummary(item.docket);
      checked++;
      if (!summary) {
        await prisma.item.update({ where: { id: item.id }, data: { commentsCheckedAt: new Date() } });
        continue;
      }

      const before = item.commentCount;
      const after = summary.total;

      await prisma.item.update({
        where: { id: item.id },
        data: {
          commentCount: after,
          recentCommenters: summary.recent as object,
          commentsCheckedAt: new Date(),
        },
      });

      // The first reading is not news. A jump afterwards is.
      if (before !== null && after > before) {
        const added = after - before;
        const who = summary.recent.slice(0, 3).map((c) => c.submitter).filter(Boolean);
        await prisma.finding.create({
          data: {
            itemId: item.id,
            source: SourceKind.REGULATIONS_GOV,
            summary:
              `${added} new comment${added === 1 ? "" : "s"} filed, ${after} in total.` +
              (who.length ? ` Most recent: ${who.join(", ")}.` : ""),
            detail: { before, after, recent: summary.recent } as object,
          },
        });
        changed++;
      }
    }

    await prisma.agentRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: true, checked, created: 0, changed },
    });
    return { ok: true, checked, created: 0, changed, skipped };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, checked, created: 0, changed, error: message },
    });
    throw err;
  }
}
