import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { SourceKind, WatchKind } from "@prisma/client";

const Body = z.object({
  actor: z.string().min(1),
  kind: z.nativeEnum(WatchKind),
  value: z.string().min(2),
  label: z.string().min(1),
  note: z.string().optional(),
  divisionId: z.string().nullable().optional(),
  source: z.nativeEnum(SourceKind).default(SourceKind.FEDERAL_REGISTER),
});

/** Add something to what the collectors look for, from now on. */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  if (b.kind === WatchKind.EXCLUDE) {
    try { new RegExp(b.value); }
    catch { return NextResponse.json({ error: "That is not a valid pattern." }, { status: 400 }); }
  }

  const clash = await prisma.watch.findUnique({ where: { kind_value: { kind: b.kind, value: b.value } } });
  if (clash) {
    if (!clash.active) {
      await prisma.watch.update({ where: { id: clash.id }, data: { active: true, addedBy: b.actor } });
      return NextResponse.json({ ok: true, id: clash.id, reactivated: true });
    }
    return NextResponse.json({ error: "That is already on the watchlist.", id: clash.id }, { status: 409 });
  }

  const w = await prisma.watch.create({
    data: {
      kind: b.kind, value: b.value, label: b.label, note: b.note ?? null,
      divisionId: b.divisionId ?? null, source: b.source, addedBy: b.actor,
    },
  });
  await prisma.audit.create({
    data: { actor: b.actor, field: "watchlist", toValue: `added ${b.kind.toLowerCase()} “${b.label}”` },
  });
  return NextResponse.json({ ok: true, id: w.id });
}
