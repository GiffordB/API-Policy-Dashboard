import { NextRequest, NextResponse } from "next/server";
import { collectFederalRegister } from "@/lib/collect";
import { collectCongress } from "@/lib/collect-congress";
import { collectRegulations } from "@/lib/collect-regulations";
import { collectOpenStates } from "@/lib/collect-openstates";

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
    if (source === "regulations") return NextResponse.json({ regulations: await collectRegulations() });
    if (source === "states") return NextResponse.json({ states: await collectOpenStates(d) });

    // All of them, and one failing source must not hide another's result.
    // States are not in "all": Open States allows a few hundred requests a day,
    // so it runs on its own daily schedule rather than every hour.
    const [fr, cg, rg] = await Promise.allSettled([
      collectFederalRegister(d), collectCongress(d), collectRegulations(),
    ]);
    const val = (r: PromiseSettledResult<unknown>) =>
      r.status === "fulfilled" ? r.value : { error: String((r.reason as Error)?.message ?? r.reason) };
    return NextResponse.json({
      federalRegister: val(fr), congress: val(cg), regulations: val(rg),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
