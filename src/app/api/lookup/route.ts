import { NextRequest, NextResponse } from "next/server";
import { fetchOne, search, stageFor, docketFor, agencyShortName } from "@/lib/sources/federal-register";
import { inferDivision, inferTopics } from "@/lib/routing";

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
    const results = (docs as NonNullable<Awaited<ReturnType<typeof fetchOne>>>[]).map((doc) => {
      const agency = agencyShortName(doc);
      const { stage } = stageFor(doc);
      return {
        docket: docketFor(doc),
        title: doc.title,
        agency,
        unit: doc.agencies?.[0]?.name ?? null,
        stage,
        commentDueAt: doc.comments_close_on,
        publishedOn: doc.publication_date,
        sourceUrl: doc.html_url,
        suggestedDivision: inferDivision(agency, doc.title, doc.abstract).division,
        topics: inferTopics(doc.title, doc.abstract),
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
