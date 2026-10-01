import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Position, Priority, SourceKind, Track, Triage } from "@prisma/client";
import { liftBlock } from "@/lib/blocklist";
import { pinDocket, sweepAgency } from "@/lib/watch-add";
import { collectDocket } from "@/lib/collect";

const Body = z.object({
  actor: z.string().min(1),
  docket: z.string().min(1),
  title: z.string().min(1),
  agency: z.string().min(1),
  unit: z.string().optional(),
  track: z.nativeEnum(Track).default(Track.FEDERAL),
  stage: z.string().default("Comment open"),
  commentDueAt: z.string().nullable().optional(),   // ISO date
  divisionId: z.string(),
  ownerId: z.string().nullable().optional(),
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
  position: z.nativeEnum(Position).default(Position.PENDING),
  topics: z.array(z.string()).default([]),
  sourceUrl: z.string().url().optional(),
  /**
   * The Federal Register slug for the agency, when the lookup found one.
   * Sweeping everything the agency publishes is a bigger decision than
   * tracking one rule, so the form asks and this says what was chosen.
   */
  agencySlug: z.string().optional(),
  agencyName: z.string().optional(),
  sweepAgency: z.boolean().default(false),
});

const STAGE_INDEX: Record<string, number> = {
  "Pre-rule": 0, Proposed: 1, "Comment open": 2, "OMB review": 3, Final: 4, Effective: 5,
};

/** Track a reg the collectors missed, or one with no public record yet. */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  const clash = await prisma.item.findUnique({ where: { docket: b.docket } });
  if (clash) return NextResponse.json({ error: "That docket is already tracked.", id: clash.id }, { status: 409 });

  // A direct add is the way back from "do not track". Adding the docket by
  // hand is a person saying, plainly, that it matters after all — so it lifts
  // the block rather than colliding with it.
  const unblocked = await liftBlock(b.docket, b.actor);

  if (b.ownerId) {
    const p = await prisma.person.findUnique({ where: { id: b.ownerId } });
    if (!p || p.divisionId !== b.divisionId)
      return NextResponse.json({ error: "that person is not on this division's roster" }, { status: 400 });
  }

  const due = b.commentDueAt ? new Date(b.commentDueAt) : null;
  const item = await prisma.item.create({
    data: {
      docket: b.docket, title: b.title, agency: b.agency, unit: b.unit ?? null,
      track: b.track, stage: b.stage, stageIndex: STAGE_INDEX[b.stage] ?? 1,
      commentDueAt: due,
      isCommentPeriod: !!due && due >= new Date(),
      nextLabel: due ? `Comments due ${due.toISOString().slice(0, 10)}` : "No date set",
      divisionId: b.divisionId, ownerId: b.ownerId ?? null,
      // Adding something by hand is a decision, so it starts tracked rather
      // than landing back in the inbox a person just picked it out of.
      triage: Triage.TRACKED, triagedBy: b.actor, triagedAt: new Date(),
      priority: b.priority, priorityConfirmed: true,
      topics: b.topics.length ? b.topics : ["Untagged"],
      position: b.position,
      positionSetBy: b.position === Position.PENDING ? null : b.actor,
      positionSetAt: b.position === Position.PENDING ? null : new Date(),
      source: b.sourceUrl ? SourceKind.FEDERAL_REGISTER : SourceKind.MANUAL,
      sourceUrl: b.sourceUrl ?? null,
    },
  });
  await prisma.$transaction([
    prisma.audit.create({
      data: {
        itemId: item.id, actor: b.actor, field: "tracking",
        toValue: unblocked ? "added by hand, after being set to do not track" : "added by hand",
      },
    }),
    prisma.finding.create({
      data: {
        itemId: item.id, source: SourceKind.MANUAL,
        summary: unblocked
          ? `Added by ${b.actor}, lifting an earlier “do not track”. The collectors will follow this docket again — the record starts fresh, without the history it had before.`
          : `Added by ${b.actor}. The collectors will watch this docket from now on.`,
      },
    }),
  ]);
  /*
   * Now make it track.
   *
   * A row in the table is not tracking. These three steps are what turn a
   * hand-typed record into one the collectors keep up to date:
   *
   *   1. pin the docket, so every run reads it from then on;
   *   2. read it from the Federal Register at once, so the stored fields are
   *      the agency's own rather than what somebody typed from a screenshot;
   *   3. if asked, sweep the agency, so the next rule from the same office
   *      arrives on its own instead of waiting to be noticed.
   *
   * None of it is allowed to lose the record. A docket the Federal Register
   * does not know, or an API having a bad minute, leaves the record saved and
   * says what did not happen.
   */
  const started: string[] = [];
  const failed: string[] = [];

  try {
    const pin = await pinDocket(item.docket, item.title, {
      actor: b.actor, divisionId: b.divisionId,
      source: b.track === Track.CONGRESS ? SourceKind.CONGRESS_GOV : SourceKind.FEDERAL_REGISTER,
    });
    started.push(pin.created ? "pinned the docket" : pin.resumed ? "resumed the docket pin" : "the docket was already pinned");
  } catch { failed.push("the docket could not be pinned"); }

  if (b.sweepAgency && b.agencySlug) {
    try {
      const sweep = await sweepAgency(b.agencySlug, b.agencyName || b.agency, {
        actor: b.actor, divisionId: b.divisionId,
        note: `Added with ${item.docket}.`,
      });
      started.push(
        sweep.created ? `now sweeping everything ${b.agencyName || b.agency} publishes`
          : sweep.resumed ? `resumed the sweep of ${b.agencyName || b.agency}`
          : `${b.agencyName || b.agency} was already swept`
      );
    } catch { failed.push("the agency sweep could not be added"); }
  }

  // Only the Federal Register can be read on demand. A bill or a state record
  // waits for its own collector, and says so rather than pretending.
  let refreshed = false;
  if (b.track === Track.FEDERAL) {
    try {
      const r = await collectDocket(item.docket);
      refreshed = r.found > 0;
      started.push(refreshed
        ? "read the docket from the Federal Register"
        : "the Federal Register has nothing under that docket yet");
    } catch { failed.push("the Federal Register could not be read just now"); }
  }

  return NextResponse.json({ ok: true, id: item.id, unblocked, refreshed, started, failed });
}
