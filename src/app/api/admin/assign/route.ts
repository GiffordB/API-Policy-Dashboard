import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Track } from "@prisma/client";

/**
 * Fills an owner on every item that has none.
 *
 * This is a setup tool, not a workflow. It spreads unowned items evenly across
 * a division's roster, and sends court items to that division's litigation
 * lead. It never moves an item that already has an owner, so nobody's real
 * assignment is overwritten.
 *
 * In day-to-day use a lead assigns work by hand. This exists so a fresh
 * install is not 276 rows of "Owner needed".
 */
export async function POST(req: NextRequest) {
  const secret = process.env.COLLECT_SECRET;
  if (!secret || req.headers.get("x-collect-secret") !== secret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const actor = req.nextUrl.searchParams.get("actor") ?? "setup";
  const people = await prisma.person.findMany({
    where: { active: true },
    orderBy: [{ divisionId: "asc" }, { name: "asc" }],
  });
  const byDivision = new Map<string, typeof people>();
  for (const p of people) {
    if (!byDivision.has(p.divisionId)) byDivision.set(p.divisionId, []);
    byDivision.get(p.divisionId)!.push(p);
  }

  const unowned = await prisma.item.findMany({
    where: { ownerId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, divisionId: true, track: true },
  });

  const counters = new Map<string, number>();
  let assigned = 0;
  const noRoster = new Set<string>();

  for (const it of unowned) {
    const roster = byDivision.get(it.divisionId);
    if (!roster?.length) { noRoster.add(it.divisionId); continue; }

    const litigation = roster.find((p) => p.isLitigationLead);
    const pick = it.track === Track.COURT && litigation
      ? litigation
      : roster[(counters.get(it.divisionId) ?? 0) % roster.length];
    if (!(it.track === Track.COURT && litigation))
      counters.set(it.divisionId, (counters.get(it.divisionId) ?? 0) + 1);

    await prisma.$transaction([
      prisma.item.update({ where: { id: it.id }, data: { ownerId: pick.id } }),
      prisma.audit.create({
        data: { itemId: it.id, actor, field: "owner", fromValue: "none", toValue: pick.name },
      }),
    ]);
    assigned++;
  }

  return NextResponse.json({
    assigned,
    divisionsWithoutRoster: [...noRoster],
    note: "Only items with no owner were touched.",
  });
}
