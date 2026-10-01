import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Track } from "@prisma/client";
import { collectDocket } from "@/lib/collect";

export const maxDuration = 60;

/**
 * Read one record's docket from the Federal Register now.
 *
 * The scheduled run reads everything hourly, which is right for a sweep and
 * useless when somebody is looking at one record and wants to know whether the
 * deadline on screen is still the deadline. This is that button.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const item = await prisma.item.findUnique({
    where: { id },
    select: { docket: true, track: true, commentDueAt: true, stage: true },
  });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (item.track !== Track.FEDERAL)
    return NextResponse.json(
      { error: "Only Federal Register records can be read on demand. Bills wait for the Congress run." },
      { status: 400 }
    );

  try {
    const r = await collectDocket(item.docket);
    if (!r.found)
      return NextResponse.json({ ok: true, found: 0, note: "The Federal Register has nothing under that docket." });
    const after = await prisma.item.findUnique({
      where: { id }, select: { commentDueAt: true, stage: true },
    });
    const moved =
      after?.stage !== item.stage ||
      after?.commentDueAt?.getTime() !== item.commentDueAt?.getTime();
    return NextResponse.json({ ok: true, found: r.found, changed: r.changed > 0 || moved });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The Federal Register could not be read." },
      { status: 502 }
    );
  }
}
