import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Position, Triage } from "@prisma/client";

const Body = z.object({
  actor: z.string().min(1),
  ids: z.array(z.string()).min(1).max(500),
  position: z.nativeEnum(Position),
});

/**
 * Track a batch of inbox records with one position.
 *
 * An inbox of four hundred records cannot be cleared one row at a time, and an
 * inbox nobody can clear is one nobody opens. This is the tool for the first
 * pass: everything in the current view becomes tracked with the position
 * given, usually Monitor, and the queue empties into real work that can be
 * sorted properly afterwards.
 *
 * It only ever tracks. There is no bulk delete: removing four hundred records
 * on one press is not a decision anybody should be able to make by accident.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { actor, ids, position } = parsed.data;
  if (position === Position.PENDING)
    return NextResponse.json({ error: "Choose a position. No position is not a decision." }, { status: 400 });

  const rows = await prisma.item.findMany({
    where: { id: { in: ids }, triage: Triage.INBOX },
    select: { id: true, position: true },
  });
  if (!rows.length) return NextResponse.json({ ok: true, tracked: 0 });

  const now = new Date();
  await prisma.$transaction([
    prisma.item.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { triage: Triage.TRACKED, triagedBy: actor, triagedAt: now, position, positionSetBy: actor, positionSetAt: now },
    }),
    // One audit row each: a batch decision is still a decision per record, and
    // the trail has to show who made it.
    prisma.audit.createMany({
      data: rows.map((r) => ({
        itemId: r.id, actor, field: "tracking",
        fromValue: "in the inbox",
        toValue: `tracked in a batch, position ${position.toLowerCase()}`,
        at: now,
      })),
    }),
  ]);
  return NextResponse.json({ ok: true, tracked: rows.length });
}
