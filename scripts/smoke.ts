/**
 * Hits the live Federal Register API and prints what a collector run would
 * create. No database needed — this is the fastest way to check that the
 * agency list and the division routing rules still make sense.
 *   npm run smoke            → the last 14 days
 *   npm run smoke -- 60
 */
import { fetchRecent, stageFor, docketFor, agencyShortName, isNoise } from "../src/lib/sources/federal-register";
import { inferDivision, inferTopics } from "../src/lib/routing";

const days = Number(process.argv[2] ?? 14);
const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

(async () => {
  const all = await fetchRecent(since, 3);
  const docs = all.filter((d) => !isNoise(d));
  console.log(`Federal Register: ${all.length} documents since ${since}`);
  console.log(`routine paperwork dropped: ${all.length - docs.length}`);
  console.log(`tracked: ${docs.length}\n`);

  const byDivision: Record<string, number> = {};
  let unsure = 0, openWindows = 0;

  for (const doc of docs) {
    const agency = agencyShortName(doc);
    const { division, confident } = inferDivision(agency, doc.title, doc.abstract);
    byDivision[division] = (byDivision[division] ?? 0) + 1;
    if (!confident) unsure++;
    if (doc.comments_close_on && new Date(doc.comments_close_on) >= new Date()) openWindows++;
  }

  console.log("routed to:", byDivision);
  console.log(`open comment windows: ${openWindows}`);
  console.log(`low confidence, a human must confirm the division: ${unsure}\n`);

  console.log("first five, as they would be stored:");
  for (const doc of docs.slice(0, 5)) {
    const agency = agencyShortName(doc);
    const { division } = inferDivision(agency, doc.title, doc.abstract);
    console.log(` · [${division}] ${agency} — ${doc.title.slice(0, 74)}`);
    console.log(`   ${docketFor(doc)} · ${stageFor(doc).stage} · due ${doc.comments_close_on ?? "—"} · ${inferTopics(doc.title, doc.abstract).join(", ")}`);
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
