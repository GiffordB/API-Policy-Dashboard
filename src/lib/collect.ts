import { prisma } from "@/lib/prisma";
import { Priority, SourceKind, Track, WatchKind } from "@prisma/client";
import {
  fetchRecent, fetchByDocket, search, stageFor, docketFor, agencyShortName, isNoise,
  DEFAULT_AGENCIES, DEFAULT_EXCLUDES, type FrDoc,
} from "@/lib/sources/federal-register";
import { inferDivision, inferTopics, guessPriority } from "@/lib/routing";

type Snapshot = {
  title: string; stage: string; commentsCloseOn: string | null;
  effectiveOn: string | null; action: string | null;
};

const snapshotOf = (doc: FrDoc, stage: string): Snapshot => ({
  title: doc.title, stage,
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

/** The live watchlist. Falls back to the built-in defaults on an unseeded database. */
async function loadWatchlist() {
  const rows = await prisma.watch.findMany({
    where: { active: true, source: SourceKind.FEDERAL_REGISTER },
  });
  const of = (k: WatchKind) => rows.filter((r) => r.kind === k);

  const agencies = of(WatchKind.AGENCY);
  const excludes = of(WatchKind.EXCLUDE);
  return {
    rows,
    agencies: agencies.length ? agencies : null,
    agencySlugs: agencies.length
      ? agencies.map((a) => a.value)
      : (DEFAULT_AGENCIES as unknown as string[]),
    terms: of(WatchKind.TERM),
    dockets: of(WatchKind.DOCKET),
    excludePatterns: excludes.length
      ? excludes.map((e) => {
          try { return new RegExp(e.value, "i"); } catch { return /$a^/; }  // a bad pattern matches nothing
        })
      : DEFAULT_EXCLUDES,
  };
}

type Tally = { created: number; changed: number; skipped: number };

/**
 * Store one Federal Register document.
 * Agent-owned fields only — a human's priority, division and owner are never
 * overwritten. `watchId` records which watchlist entry brought it in.
 */
async function ingest(doc: FrDoc, watchId: string | null, tally: Tally) {
  const docket = docketFor(doc);
  const agency = agencyShortName(doc);
  const { stage, stageIndex } = stageFor(doc);
  const snap = snapshotOf(doc, stage);
  const commentDueAt = doc.comments_close_on ? new Date(doc.comments_close_on) : null;
  const isOpen = !!commentDueAt && commentDueAt >= new Date();
  const nextLabel = commentDueAt
    ? `Comments due ${doc.comments_close_on}`
    : doc.effective_on ? `Effective ${doc.effective_on}` : `Published ${doc.publication_date}`;

  const existing = await prisma.item.findUnique({ where: { docket } });

  if (!existing) {
    const { division, confident } = inferDivision(agency, doc.title, doc.abstract);
    const item = await prisma.item.create({
      data: {
        docket, title: doc.title, agency,
        unit: doc.agencies?.[0]?.name ?? null,
        track: Track.FEDERAL, stage, stageIndex,
        nextLabel, commentDueAt, isCommentPeriod: isOpen,
        divisionId: division,
        priority: guessPriority(commentDueAt, stage) as Priority,
        priorityConfirmed: false,
        topics: inferTopics(doc.title, doc.abstract),
        abstract: doc.abstract,
        publishedOn: new Date(doc.publication_date),
        source: SourceKind.FEDERAL_REGISTER,
        sourceUrl: doc.html_url,
        frCitation: doc.citation,
        foundByWatchId: watchId,
        lastSnapshot: snap as object,
        lastSeenAt: new Date(),
      },
    });
    await prisma.finding.create({
      data: {
        itemId: item.id, source: SourceKind.FEDERAL_REGISTER,
        summary: confident
          ? `New ${doc.type === "RULE" ? "final rule" : "proposal"} from ${agency}.`
          : `New ${agency} document. The division is a guess — please confirm it.`,
        detail: snap as object,
      },
    });
    tally.created++;
    return;
  }

  const before = (existing.lastSnapshot ?? null) as Snapshot | null;
  const lines = before ? diff(before, snap) : [];
  if (lines.length) {
    await prisma.finding.create({
      data: {
        itemId: existing.id, source: SourceKind.FEDERAL_REGISTER,
        summary: lines.join(" "),
        detail: { before, after: snap } as object,
      },
    });
    tally.changed++;
  } else {
    tally.skipped++;
  }
  await prisma.item.update({
    where: { id: existing.id },
    data: {
      title: doc.title, abstract: doc.abstract, stage, stageIndex,
      commentDueAt, isCommentPeriod: isOpen,
      nextLabel: commentDueAt || doc.effective_on ? nextLabel : existing.nextLabel,
      sourceUrl: doc.html_url, frCitation: doc.citation,
      foundByWatchId: existing.foundByWatchId ?? watchId,
      lastSnapshot: snap as object, lastSeenAt: new Date(),
    },
  });
}

/**
 * One collector run, driven by the watchlist.
 *
 * Three sweeps: everything a watched agency published, everything matching a
 * watched term, and every document in a pinned docket. A term or a docket
 * reaches beyond the agency list on purpose — that is how something you could
 * not find gets tracked from then on.
 */
export async function collectFederalRegister(sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const run = await prisma.agentRun.create({ data: { source: SourceKind.FEDERAL_REGISTER } });
  const tally: Tally = { created: 0, changed: 0, skipped: 0 };
  let checked = 0;

  try {
    const wl = await loadWatchlist();
    const seen = new Set<string>();
    const now = new Date();

    // 1. the agency sweep
    const docs = await fetchRecent(since, wl.agencySlugs);
    const bySlug = new Map((wl.agencies ?? []).map((a) => [a.value, a]));
    const hits = new Map<string, number>();

    for (const doc of docs) {
      checked++;
      if (isNoise(doc, wl.excludePatterns)) continue;
      const slug = doc.agencies?.map((a) => a.slug).find((s) => s && bySlug.has(s));
      const watch = slug ? bySlug.get(slug) ?? null : null;
      if (watch) hits.set(watch.id, (hits.get(watch.id) ?? 0) + 1);
      seen.add(docketFor(doc));
      await ingest(doc, watch?.id ?? null, tally);
    }

    // 2. the term sweep — reaches past the agency list
    for (const term of wl.terms) {
      const found = await search(term.value, 40);
      let n = 0;
      for (const doc of found) {
        checked++;
        if (isNoise(doc, wl.excludePatterns)) continue;
        if (new Date(doc.publication_date) < new Date(since)) continue;
        const key = docketFor(doc);
        if (seen.has(key)) continue;
        seen.add(key);
        n++;
        await ingest(doc, term.id, tally);
      }
      hits.set(term.id, n);
    }

    // 3. pinned dockets — followed whatever they are called
    for (const pin of wl.dockets) {
      const found = await fetchByDocket(pin.value);
      let n = 0;
      for (const doc of found) {
        checked++;
        const key = docketFor(doc);
        if (seen.has(key)) continue;
        seen.add(key);
        n++;
        await ingest(doc, pin.id, tally);   // a pinned docket is never noise
      }
      hits.set(pin.id, n);
    }

    // proof of worth, per watchlist entry
    for (const w of wl.rows) {
      const n = hits.get(w.id) ?? 0;
      await prisma.watch.update({
        where: { id: w.id },
        data: { lastRunAt: now, lastHits: n, totalHits: { increment: n } },
      });
    }

    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(), ok: true, checked,
        created: tally.created, changed: tally.changed,
      },
    });
    return { ok: true, checked, ...tally };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(), ok: false, checked,
        created: tally.created, changed: tally.changed, error: message,
      },
    });
    throw err;
  }
}
