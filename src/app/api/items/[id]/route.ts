import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Priority } from "@prisma/client";

const Body = z.object({
  actor: z.string().min(1),
  priority: z.nativeEnum(Priority).optional(),
  divisionId: z.string().optional(),
  ownerId: z.string().nullable().optional(),
});

const LABEL: Record<string, string> = {
  URGENT: "URGENT", HIGH: "High", MEDIUM: "Medium", LOW: "Low", NOT_RELEVANT: "Not relevant",
};

/** One edit, one audit row. The audit is written in the same transaction as the change. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { actor, priority, divisionId, ownerId } = parsed.data;

  const item = await prisma.item.findUnique({ where: { id }, include: { owner: true, division: true } });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  const audits: { field: string; fromValue: string | null; toValue: string | null }[] = [];
  const data: Record<string, unknown> = {};

  if (priority && priority !== item.priority) {
    audits.push({ field: "priority", fromValue: LABEL[item.priority], toValue: LABEL[priority] });
    data.priority = priority;
    data.priorityConfirmed = true;
  } else if (priority && !item.priorityConfirmed) {
    audits.push({ field: "priority", fromValue: `${LABEL[item.priority]} (agent guess)`, toValue: LABEL[priority] });
    data.priorityConfirmed = true;
  }

  if (divisionId && divisionId !== item.divisionId) {
    const to = await prisma.division.findUnique({ where: { id: divisionId } });
    if (!to) return NextResponse.json({ error: "unknown division" }, { status: 400 });
    audits.push({ field: "division", fromValue: item.division.name, toValue: to.name });
    data.divisionId = divisionId;
    // The owner belongs to the old division's roster, so the move clears it.
    if (item.ownerId) {
      const stillValid = await prisma.person.findFirst({ where: { id: item.ownerId, divisionId } });
      if (!stillValid) {
        audits.push({ field: "owner", fromValue: item.owner?.name ?? null, toValue: "cleared by the division change" });
        data.ownerId = null;
      }
    }
  }

  if (ownerId !== undefined && ownerId !== item.ownerId) {
    const to = ownerId ? await prisma.person.findUnique({ where: { id: ownerId } }) : null;
    if (ownerId && !to) return NextResponse.json({ error: "unknown person" }, { status: 400 });
    const targetDivision = (data.divisionId as string) ?? item.divisionId;
    if (to && to.divisionId !== targetDivision)
      return NextResponse.json({ error: "that person is not on this division's roster" }, { status: 400 });
    audits.push({ field: "owner", fromValue: item.owner?.name ?? "none", toValue: to?.name ?? "none" });
    data.ownerId = ownerId;
  }

  if (!Object.keys(data).length) return NextResponse.json({ ok: true, unchanged: true });

  await prisma.$transaction([
    prisma.item.update({ where: { id }, data }),
    ...audits.map((a) => prisma.audit.create({ data: { itemId: id, actor, ...a } })),
  ]);
  return NextResponse.json({ ok: true });
}
