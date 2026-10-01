import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { WatchKind } from "@prisma/client";
import { fetchAgencies } from "@/lib/sources/federal-register";

/**
 * The agencies that can be swept, and which already are.
 *
 * Backs the agency picker. A slug typed from memory is a watch that finds
 * nothing for ever and gives no sign why, so the list is the real one from the
 * Federal Register and a person chooses from it rather than typing.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  try {
    const [all, watched] = await Promise.all([
      fetchAgencies(),
      prisma.watch.findMany({
        where: { kind: WatchKind.AGENCY },
        select: { value: true, active: true },
      }),
    ]);
    const state = new Map(watched.map((w) => [w.value, w.active]));

    /*
     * Words people search for that the Federal Register does not use.
     *
     * "OIRA" finds nothing in the register's own list, because a rule under
     * OIRA review has not been published and so is not in the register at all.
     * Searching for it and getting a blank is the worst answer: it reads as
     * "we do not cover that", when what is true is subtler. So the search
     * lands on OMB, and the note on the coverage page says what that can and
     * cannot show.
     */
    const SYNONYM: Record<string, string> = {
      oira: "management-and-budget-office",
      omb: "management-and-budget-office",
      "regulatory affairs": "management-and-budget-office",
      msha: "mine-safety-and-health-administration",
      phmsa: "pipeline-and-hazardous-materials-safety-administration",
      ferc: "federal-energy-regulatory-commission",
      blm: "land-management-bureau",
      boem: "ocean-energy-management-bureau",
      bsee: "safety-and-environmental-enforcement-bureau",
    };
    const alias = SYNONYM[q];
    if (alias) {
      const a = all.find((x) => x.slug === alias);
      if (a)
        return NextResponse.json({
          total: all.length,
          note: q === "oira"
            ? "The Federal Register has no OIRA. OIRA sits inside OMB, and a rule under OIRA review has not been published yet, so the register cannot show it. Sweeping OMB gets what OMB itself publishes."
            : undefined,
          results: [{
            slug: a.slug, name: a.name, shortName: a.shortName,
            watched: state.get(a.slug) === true,
            paused: state.get(a.slug) === false,
          }],
        });
    }

    const hit = q
      ? all.filter((a) =>
          a.name.toLowerCase().includes(q) ||
          (a.shortName ?? "").toLowerCase().includes(q) ||
          a.slug.includes(q.replace(/\s+/g, "-")))
      : all;
    return NextResponse.json({
      total: all.length,
      results: hit.slice(0, 40).map((a) => ({
        slug: a.slug, name: a.name, shortName: a.shortName,
        watched: state.get(a.slug) === true,
        paused: state.get(a.slug) === false,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { results: [], error: e instanceof Error ? e.message : "The agency list could not be read." },
      { status: 502 }
    );
  }
}
