import { NextRequest, NextResponse } from "next/server";
import { fetchOne, search, stageFor, docketFor, agencyShortName } from "@/lib/sources/federal-register";
import { inferDivision, inferTopics } from "@/lib/routing";
import { blockedDockets } from "@/lib/blocklist";
import { prisma } from "@/lib/prisma";
import { WatchKind } from "@prisma/client";

/**
 * Backs the "add a reg" form.
 * A Federal Register document number or URL returns one record.
 * Anything else is treated as a search term.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [] });

  // https://www.federalregister.gov/documents/2026/09/15/2026-12345/slug  →  2026-12345
  const fromUrl = q.match(/federalregister\.gov\/documents\/\d{4}\/\d{2}\/\d{2}\/([\w-]+)/)?.[1];
  const looksLikeDocNumber = /^\d{4}-\d{3,6}$/.test(q);
  const key = fromUrl ?? (looksLikeDocNumber ? q : null);

  try {
    const docs = key ? [await fetchOne(key)].filter(Boolean) : await search(q, 12);
    // A hit somebody removed with "do not track" is still shown, and marked.
    // Hiding it would look like the search was broken; the form says plainly
    // that adding it lifts the block.
    const blocked = await blockedDockets();
    // Which agencies are already swept, so the form can offer the sweep only
    // where it would actually change something.
    const swept = new Set(
      (await prisma.watch.findMany({
        where: { kind: WatchKind.AGENCY, active: true }, select: { value: true },
      })).map((w) => w.value)
    );
    const results = (docs as NonNullable<Awaited<ReturnType<typeof fetchOne>>>[]).map((doc) => {
      const agency = agencyShortName(doc);
      const { stage } = stageFor(doc);
      /*
       * The agency behind the document, as the Federal Register keys it.
       *
       * The document lists its parent department as well as the office that
       * wrote it ("Energy Department" and "Federal Energy Regulatory
       * Commission"). The office is the useful one to sweep, so prefer the
       * first entry that is not a department.
       */
      const withSlug = (doc.agencies ?? []).filter((a) => a.slug);
      const office = withSlug.find((a) => !/Department$/.test(a.name)) ?? withSlug[0];
      return {
        docket: docketFor(doc),
        blocked: blocked.has(docketFor(doc)),
        title: doc.title,
        agency,
        unit: doc.agencies?.[0]?.name ?? null,
        stage,
        commentDueAt: doc.comments_close_on,
        publishedOn: doc.publication_date,
        sourceUrl: doc.html_url,
        suggestedDivision: inferDivision(agency, doc.title, doc.abstract).division,
        topics: inferTopics(doc.title, doc.abstract),
        agencySlug: office?.slug ?? null,
        agencyName: office?.name ?? null,
        agencySwept: office?.slug ? swept.has(office.slug) : false,
      };
    });
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { results: [], error: e instanceof Error ? e.message : "lookup failed" },
      { status: 502 }
    );
  }
}
