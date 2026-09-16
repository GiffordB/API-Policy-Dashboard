import { NextRequest, NextResponse } from "next/server";
import { collectFederalRegister } from "@/lib/collect";
import { collectCongress } from "@/lib/collect-congress";

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
  const d = Number.isFinite(days) ? days : 30;
  const source = (req.nextUrl.searchParams.get("source") ?? "all").toLowerCase();
  try {
    if (source === "federal") return NextResponse.json({ federalRegister: await collectFederalRegister(d) });
    if (source === "congress") return NextResponse.json({ congress: await collectCongress(d) });

    // Both, and one failing source must not hide the other's result.
    const [fr, cg] = await Promise.allSettled([collectFederalRegister(d), collectCongress(d)]);
    return NextResponse.json({
      federalRegister: fr.status === "fulfilled" ? fr.value : { error: String(fr.reason?.message ?? fr.reason) },
      congress: cg.status === "fulfilled" ? cg.value : { error: String(cg.reason?.message ?? cg.reason) },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
