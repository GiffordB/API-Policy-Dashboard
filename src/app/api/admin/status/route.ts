import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { whichDatabase } from "@/lib/db-label";

/**
 * What the running server actually has.
 *
 * Reports whether each environment variable is present — never its value — plus
 * the record counts that tell you whether a setup step worked. A Vercel
 * environment variable only reaches a NEW deployment, so "set in the dashboard"
 * and "visible to the server" are different facts, and this reports the second.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.COLLECT_SECRET;
  if (!secret || req.headers.get("x-collect-secret") !== secret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const present = (k: string) => Boolean(process.env[k]?.trim());

  const [divisions, byDivision, byTrack, items, unowned, openWindows, runs] = await Promise.all([
    prisma.division.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.item.groupBy({ by: ["divisionId"], _count: true }),
    prisma.item.groupBy({ by: ["track"], _count: true }),
    prisma.item.count(),
    prisma.item.count({ where: { ownerId: null } }),
    prisma.item.count({ where: { isCommentPeriod: true, commentDueAt: { gte: new Date() } } }),
    prisma.agentRun.findMany({ orderBy: { startedAt: "desc" }, take: 5 }),
  ]);

  const nameOf = Object.fromEntries(divisions.map((d) => [d.id, d.name]));

  return NextResponse.json({
    // The scheduled job prints this same line. If they differ, the job is
    // pointed at the wrong database.
    database: whichDatabase(),
    env: {
      DATABASE_URL: present("DATABASE_URL"),
      ANTHROPIC_API_KEY: present("ANTHROPIC_API_KEY"),
      DATA_GOV_API_KEY: present("DATA_GOV_API_KEY"),
      OPENSTATES_API_KEY: present("OPENSTATES_API_KEY"),
      COURTLISTENER_TOKEN: present("COURTLISTENER_TOKEN"),
      APP_PASSWORD: present("APP_PASSWORD"),
      COLLECT_SECRET: present("COLLECT_SECRET"),
    },
    counts: {
      items,
      people: await prisma.person.count(),
      unowned,
      openCommentWindows: openWindows,
      awaitingClassifier: await prisma.item.count({ where: { divisionId: "none", classifiedAt: null } }),
      byDivision: Object.fromEntries(byDivision.map((r) => [nameOf[r.divisionId] ?? r.divisionId, r._count])),
      byTrack: Object.fromEntries(byTrack.map((r) => [r.track, r._count])),
    },
    recentRuns: runs.map((r) => ({
      source: r.source, ok: r.ok, at: r.startedAt.toISOString(),
      checked: r.checked, created: r.created, changed: r.changed, error: r.error,
    })),
  });
}
