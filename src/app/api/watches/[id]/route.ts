import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const Body = z.object({
  actor: z.string().min(1),
  active: z.boolean().optional(),
  label: z.string().min(1).optional(),
  note: z.string().nullable().optional(),
  divisionId: z.string().nullable().optional(),
});

/**
 * Switch a watchlist entry on or off, or retitle it.
 *
 * Nothing is deleted. Turning an entry off stops future runs from using it and
 * leaves the record of what was once watched, and what it found.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { actor, ...changes } = parsed.data;

  const before = await prisma.watch.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
  if (!Object.keys(data).length) return NextResponse.json({ ok: true, unchanged: true });

  await prisma.$transaction([
    prisma.watch.update({ where: { id }, data }),
    prisma.audit.create({
      data: {
        actor, field: "watchlist",
        fromValue: before.active ? "watched" : "paused",
        toValue: "active" in data
          ? `${data.active ? "resumed" : "paused"} “${before.label}”`
          : `edited “${before.label}”`,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
