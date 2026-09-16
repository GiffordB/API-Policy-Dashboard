/**
 * Which division owns an incoming record.
 *
 * The agency alone is not enough: EPA publishes for upstream, downstream and
 * corporate policy in the same week. So each rule scores on agency plus words
 * in the title, and the best score wins. A tie, or no score at all, lands in
 * the fallback division and the item shows as unassigned for a human to fix.
 */

export type DivisionId = "up" | "mid" | "down" | "gas" | "corp" | "none";

type Rule = {
  division: DivisionId;
  agencies?: string[];        // short names, as agencyShortName returns them
  keywords?: RegExp;
  weight: number;
};

const RULES: Rule[] = [
  // ---- upstream ----
  { division: "up", agencies: ["BLM", "BOEM", "BSEE"], weight: 6 },
  { division: "up", keywords: /\b(methane|OOOO|subpart W|well|wellbore|drilling|completion|hydraulic fractur|onshore|offshore lease|royalt|bonding|orphan|plugging|produced water|setback|flaring at production)\b/i, weight: 5 },
  { division: "up", agencies: ["EPA"], keywords: /\b(oil and natural gas sector|production segment|greenhouse gas reporting)\b/i, weight: 4 },

  // ---- midstream ----
  { division: "mid", agencies: ["PHMSA"], weight: 6 },
  { division: "mid", keywords: /\b(pipeline|compressor station|class location|integrity management|leak detection and repair|gathering line|storage field|certificate of public convenience)\b/i, weight: 5 },
  { division: "mid", agencies: ["FERC"], keywords: /\b(certificate|natural gas facilit|section 7|NGA)\b/i, weight: 4 },

  // ---- downstream ----
  { division: "down", agencies: ["OSHA"], weight: 5 },
  { division: "down", keywords: /\b(refiner|refinery|flare|process safety|renewable fuel standard|RFS|fuel standard|gasoline|diesel|octane|petrochemical|storage tank|terminal)\b/i, weight: 5 },

  // ---- natural gas markets ----
  { division: "gas", agencies: ["CFTC"], weight: 6 },
  { division: "gas", keywords: /\b(LNG|liquefied natural gas|export authorization|public interest review|capacity release|gas-electric|nomination|market manipulation|position limit|hub|basis)\b/i, weight: 5 },
  { division: "gas", agencies: ["DOE"], keywords: /\b(export|import|authorization)\b/i, weight: 4 },

  // ---- corporate policy ----
  // Agency alone is not enough here. The SEC and the IRS publish thousands of
  // routine documents a year, and almost none of them are policy work.
  { division: "corp", agencies: ["IRS", "SEC", "BIS"],
    keywords: /\b(rule|rulemaking|guidance|regulation|proposed|disclosure|credit|tariff|exclusion|reporting)\b/i, weight: 6 },
  { division: "corp", keywords: /\b(tax credit|section 45|climate-related disclosure|section 232|tariff|beneficial ownership|permitting reform|NEPA|judicial review)\b/i, weight: 5 },
];

/** Not a division. It means "an agent could not tell", and a human must look. */
export const FALLBACK_DIVISION: DivisionId = "none";

export function inferDivision(agencyShort: string, title: string, abstract?: string | null) {
  const text = `${title} ${abstract ?? ""}`;
  const score: Record<string, number> = {};
  for (const r of RULES) {
    const agencyOk = !r.agencies || r.agencies.includes(agencyShort);
    const wordOk = !r.keywords || r.keywords.test(text);
    if (r.agencies && r.keywords) { if (agencyOk && wordOk) score[r.division] = (score[r.division] ?? 0) + r.weight; }
    else if (agencyOk && wordOk) score[r.division] = (score[r.division] ?? 0) + r.weight;
  }
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { division: FALLBACK_DIVISION, confident: false };
  const [best, bestScore] = ranked[0];
  const tie = ranked[1]?.[1] === bestScore;
  return { division: best as DivisionId, confident: !tie && bestScore >= 5 };
}

/** Topic tags, so the chips on a row mean something on day one. */
const TOPIC_WORDS: [string, RegExp][] = [
  ["Emissions", /\b(emission|methane|greenhouse gas|ozone|NOx|VOC)\b/i],
  ["Leak detection", /\b(leak detection|LDAR|fugitive)\b/i],
  ["Pipeline safety", /\b(pipeline safety|integrity|class location)\b/i],
  ["Permitting", /\b(permit|certificate|NEPA|review process)\b/i],
  ["Federal lands", /\b(federal land|public land|lease sale|onshore order)\b/i],
  ["Offshore", /\b(offshore|outer continental shelf|OCS)\b/i],
  ["Refining", /\b(refiner|refinery|flare)\b/i],
  ["Fuels", /\b(renewable fuel|gasoline|diesel|fuel standard)\b/i],
  ["LNG", /\b(LNG|liquefied natural gas)\b/i],
  ["Markets", /\b(market|capacity release|position limit|trading)\b/i],
  ["Tax", /\b(tax|credit|section 45)\b/i],
  ["Trade", /\b(tariff|import|export control|section 232)\b/i],
  ["Disclosure", /\b(disclosure|reporting requirement|filing)\b/i],
  ["Water", /\b(water|produced water|discharge|wastewater)\b/i],
  ["Process safety", /\b(process safety|highly hazardous)\b/i],
];

export function inferTopics(title: string, abstract?: string | null): string[] {
  const text = `${title} ${abstract ?? ""}`;
  const hits = TOPIC_WORDS.filter(([, re]) => re.test(text)).map(([t]) => t);
  return hits.length ? hits.slice(0, 4) : ["Untagged"];
}

/** A first guess at priority. Always written with priorityConfirmed = false. */
export function guessPriority(commentDueAt: Date | null, stage: string) {
  if (!commentDueAt) return stage === "Final" ? "HIGH" : "MEDIUM";
  const days = Math.ceil((commentDueAt.getTime() - Date.now()) / 86400000);
  if (days <= 14) return "HIGH";
  return "MEDIUM";
}
