import { NextRequest, NextResponse } from "next/server";
import { classifyUnassigned } from "@/lib/classify";

export const maxDuration = 300;

/** Files the Unassigned pile. Safe to run again — it only reads Unassigned. */
export async function POST(req: NextRequest) {
  const secret = process.env.COLLECT_SECRET;
  if (!secret || req.headers.get("x-collect-secret") !== secret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 60);
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  try {
    return NextResponse.json(await classifyUnassigned(Number.isFinite(limit) ? limit : 60, 12, dryRun));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
