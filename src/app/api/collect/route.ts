import { NextRequest, NextResponse } from "next/server";
import { collectFederalRegister } from "@/lib/collect";

export const maxDuration = 300;

/**
 * Manual trigger for the collector, for when you do not want to wait for cron.
 * Render's scheduled job runs `npm run collect` directly and does not use this.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.COLLECT_SECRET;
  if (!secret || req.headers.get("x-collect-secret") !== secret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const days = Number(req.nextUrl.searchParams.get("days") ?? 30);
  try {
    const r = await collectFederalRegister(Number.isFinite(days) ? days : 30);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
