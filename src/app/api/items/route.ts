import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Position, Priority, SourceKind, Track } from "@prisma/client";

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
    prisma.audit.create({ data: { itemId: item.id, actor: b.actor, field: "tracking", toValue: "added by hand" } }),
    prisma.finding.create({
      data: {
        itemId: item.id, source: SourceKind.MANUAL,
        summary: `Added by ${b.actor}. The collectors will watch this docket from now on.`,
      },
    }),
  ]);
  return NextResponse.json({ ok: true, id: item.id });
}
