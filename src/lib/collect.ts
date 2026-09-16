import { prisma } from "@/lib/prisma";
import { Priority, SourceKind, Track } from "@prisma/client";
import {
  fetchRecent, stageFor, docketFor, agencyShortName, isNoise, type FrDoc,
} from "@/lib/sources/federal-register";
import { inferDivision, inferTopics, guessPriority } from "@/lib/routing";

type Snapshot = {
  title: string; stage: string; commentsCloseOn: string | null;
  effectiveOn: string | null; action: string | null;
};

const snapshotOf = (doc: FrDoc, stage: string): Snapshot => ({
  title: doc.title,
  stage,
  commentsCloseOn: doc.comments_close_on,
  effectiveOn: doc.effective_on,
  action: doc.action,
});

/** Human sentences for what changed between two runs. */
function diff(before: Snapshot, after: Snapshot): string[] {
  const out: string[] = [];
  if (before.stage !== after.stage) out.push(`Stage moved from ${before.stage} to ${after.stage}.`);
  if (before.commentsCloseOn !== after.commentsCloseOn) {
    out.push(
      before.commentsCloseOn && after.commentsCloseOn
        ? `Comment deadline moved from ${before.commentsCloseOn} to ${after.commentsCloseOn}.`
        : after.commentsCloseOn
          ? `A comment period opened, closing ${after.commentsCloseOn}.`
          : `The comment period closed.`
    );
  }
  if (before.effectiveOn !== after.effectiveOn && after.effectiveOn)
    out.push(`Effective date set to ${after.effectiveOn}.`);
  if (before.title !== after.title) out.push(`Title changed.`);
  return out;
}

/**
 * One collector run over the Federal Register.
 * Creates items it has not seen, and writes a Finding for anything that moved.
 * It never overwrites a human's priority, division or owner.
 */
export async function collectFederalRegister(sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const run = await prisma.agentRun.create({
    data: { source: SourceKind.FEDERAL_REGISTER },
  });

  let checked = 0, created = 0, changed = 0;
  try {
    const docs = await fetchRecent(since);
    checked = docs.length;

    for (const doc of docs) {
      if (isNoise(doc)) continue;          // routine paperwork, never tracked
      const docket = docketFor(doc);
      const agency = agencyShortName(doc);
      const { stage, stageIndex } = stageFor(doc);
      const snap = snapshotOf(doc, stage);
      const commentDueAt = doc.comments_close_on ? new Date(doc.comments_close_on) : null;
      const isOpen = !!commentDueAt && commentDueAt >= new Date();

      const existing = await prisma.item.findUnique({ where: { docket } });

      if (!existing) {
        const { division, confident } = inferDivision(agency, doc.title, doc.abstract);
        const item = await prisma.item.create({
          data: {
            docket,
            title: doc.title,
            agency,
            unit: doc.agencies?.[0]?.name ?? null,
            track: Track.FEDERAL,
            stage, stageIndex,
            nextLabel: commentDueAt
              ? `Comments due ${doc.comments_close_on}`
              : doc.effective_on ? `Effective ${doc.effective_on}` : `Published ${doc.publication_date}`,
            commentDueAt,
            isCommentPeriod: isOpen,
            divisionId: division,
            priority: guessPriority(commentDueAt, stage) as Priority,
            priorityConfirmed: false,
            topics: inferTopics(doc.title, doc.abstract),
            abstract: doc.abstract,
            publishedOn: new Date(doc.publication_date),
            source: SourceKind.FEDERAL_REGISTER,
            sourceUrl: doc.html_url,
            frCitation: doc.citation,
            lastSnapshot: snap as object,
            lastSeenAt: new Date(),
          },
        });
        await prisma.finding.create({
          data: {
            itemId: item.id,
            source: SourceKind.FEDERAL_REGISTER,
            summary: confident
              ? `New ${doc.type === "RULE" ? "final rule" : "proposal"} from ${agency}.`
              : `New ${agency} document. The division is a guess — please confirm it.`,
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
            itemId: existing.id,
            source: SourceKind.FEDERAL_REGISTER,
            summary: lines.join(" "),
            detail: { before, after: snap } as object,
          },
        });
        changed++;
      }
      // Agent-owned fields only. A human's priority, division and owner are untouched.
      await prisma.item.update({
        where: { id: existing.id },
        data: {
          title: doc.title,
          abstract: doc.abstract,
          stage, stageIndex,
          commentDueAt,
          isCommentPeriod: isOpen,
          nextLabel: commentDueAt
            ? `Comments due ${doc.comments_close_on}`
            : doc.effective_on ? `Effective ${doc.effective_on}` : existing.nextLabel,
          sourceUrl: doc.html_url,
          frCitation: doc.citation,
          lastSnapshot: snap as object,
          lastSeenAt: new Date(),
        },
      });
    }

    await prisma.agentRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: true, checked, created, changed },
    });
    return { ok: true, checked, created, changed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, checked, created, changed, error: message },
    });
    throw err;
  }
}
