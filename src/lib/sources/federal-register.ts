/**
 * Federal Register API client.
 * Public, no key, no rate limit published. https://www.federalregister.gov/developers/api/v1
 * This is the one source that works the moment the app is deployed.
 */

const BASE = "https://www.federalregister.gov/api/v1/documents.json";

/**
 * The agencies a fresh install starts with. These are seeded into the watchlist
 * and are editable from the coverage page afterwards — the live list comes from
 * the database, not from here.
 */
export const DEFAULT_AGENCIES = [
  "environmental-protection-agency",
  "pipeline-and-hazardous-materials-safety-administration",
  "federal-energy-regulatory-commission",
  "land-management-bureau",
  "ocean-energy-management-bureau",
  "safety-and-environmental-enforcement-bureau",
  "energy-department",
  "internal-revenue-service",
  "securities-and-exchange-commission",
  "occupational-safety-and-health-administration",
  "industry-and-security-bureau",
  "commodity-futures-trading-commission",
  // OMB, which is OIRA's parent. The Federal Register has no OIRA agency: a
  // rule under E.O. 12866 review has not been published yet, so the register
  // cannot show it. See the note on the coverage page.
  "management-and-budget-office",
] as const;

/** Document types worth tracking. SCHEDULE and PRESDOCU are noise for this team. */
const TYPES = ["RULE", "PRORULE", "NOTICE"] as const;

const FIELDS = [
  "document_number", "title", "type", "abstract", "publication_date",
  "comments_close_on", "effective_on", "agencies", "docket_ids",
  "regulation_id_numbers", "html_url", "citation", "action",
];

export type FrDoc = {
  document_number: string;
  title: string;
  type: string;
  abstract: string | null;
  publication_date: string;
  comments_close_on: string | null;
  effective_on: string | null;
  agencies: { name: string; slug?: string; raw_name?: string }[];
  docket_ids: string[] | null;
  regulation_id_numbers: string[] | null;
  html_url: string;
  citation: string | null;
  action: string | null;
};

function url(params: Record<string, string | string[]>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
    else q.append(k, v);
  }
  return `${BASE}?${q.toString()}`;
}

/**
 * Everything published by a watched agency since `since` (YYYY-MM-DD).
 * Follows pagination up to `maxPages` so one run cannot hang on a huge window.
 */
export async function fetchRecent(
  since: string,
  agencies: string[] = DEFAULT_AGENCIES as unknown as string[],
  maxPages = 10
): Promise<FrDoc[]> {
  if (!agencies.length) return [];
  const out: FrDoc[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const u = url({
      "conditions[publication_date][gte]": since,
      "conditions[agencies][]": agencies,
      "conditions[type][]": TYPES as unknown as string[],
      "fields[]": FIELDS,
      per_page: "100",
      page: String(page),
      order: "newest",
    });
    const res = await fetch(u, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new Error(`Federal Register ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { results?: FrDoc[]; total_pages?: number };
    const results = json.results ?? [];
    out.push(...results);
    if (results.length < 100 || page >= (json.total_pages ?? 1)) break;
  }
  return out;
}

/** One document by its Federal Register number, for the "add a reg" lookup. */
export async function fetchOne(documentNumber: string): Promise<FrDoc | null> {
  const u = `https://www.federalregister.gov/api/v1/documents/${encodeURIComponent(
    documentNumber
  )}.json?fields[]=${FIELDS.join("&fields[]=")}`;
  const res = await fetch(u, { headers: { accept: "application/json" }, cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Federal Register ${res.status}`);
  return (await res.json()) as FrDoc;
}

/** Free-text search, so a person can find a rule they cannot cite by number. */
export async function search(term: string, limit = 20): Promise<FrDoc[]> {
  const u = url({
    "conditions[term]": term,
    "conditions[type][]": TYPES as unknown as string[],
    "fields[]": FIELDS,
    per_page: String(limit),
    order: "relevance",
  });
  const res = await fetch(u, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Federal Register ${res.status}`);
  const json = (await res.json()) as { results?: FrDoc[] };
  return json.results ?? [];
}

/**
 * What kind of document this is, as one of three codes.
 *
 * The API takes the codes RULE, PRORULE and NOTICE in a query but prints the
 * labels "Rule", "Proposed Rule" and "Notice" in a result. Comparing a result
 * against the codes therefore never matched, silently: every document fell
 * through to the Notice branch of stageFor, so no record was ever staged Final
 * or Proposed, and the rule in isNoise that drops a notice with no comment
 * deadline never fired at all.
 *
 * Both spellings are accepted here so neither reading can break it again.
 */
export function typeOf(doc: FrDoc): "RULE" | "PRORULE" | "NOTICE" {
  const t = (doc.type ?? "").toUpperCase();
  if (t === "RULE") return "RULE";
  if (t === "PRORULE" || t === "PROPOSED RULE") return "PRORULE";
  return "NOTICE";
}

/** The stage a document puts an item into. */
export function stageFor(doc: FrDoc): { stage: string; stageIndex: number } {
  const open = doc.comments_close_on && new Date(doc.comments_close_on) >= new Date();
  const kind = typeOf(doc);
  if (kind === "RULE") return { stage: "Final", stageIndex: 4 };
  if (kind === "PRORULE") return open
    ? { stage: "Comment open", stageIndex: 2 }
    : { stage: "Proposed", stageIndex: 1 };
  return open ? { stage: "Comment open", stageIndex: 2 } : { stage: "Notice", stageIndex: 1 };
}

/** Prefer a real docket id; fall back to the FR document number. */
export function docketFor(doc: FrDoc): string {
  return doc.docket_ids?.[0] ?? `FR-${doc.document_number}`;
}

/**
 * The Federal Register lists FERC documents under the Energy Department, and
 * BLM documents under the Interior Department. The specific body is the one
 * the policy team names, so prefer it over the parent department.
 */
export function agencyShortName(doc: FrDoc): string {
  const map: Record<string, string> = {
    "Environmental Protection Agency": "EPA",
    "Pipeline and Hazardous Materials Safety Administration": "PHMSA",
    "Federal Energy Regulatory Commission": "FERC",
    "Land Management Bureau": "BLM",
    "Ocean Energy Management Bureau": "BOEM",
    "Safety and Environmental Enforcement Bureau": "BSEE",
    "Energy Department": "DOE",
    "Internal Revenue Service": "IRS",
    "Securities and Exchange Commission": "SEC",
    "Occupational Safety and Health Administration": "OSHA",
    "Industry and Security Bureau": "BIS",
    "Commodity Futures Trading Commission": "CFTC",
  };
  const names = (doc.agencies ?? []).map((a) => a.name);
  const specific = names.find((n) => map[n] && !/Department$/.test(n));
  if (specific) return map[specific];
  const any = names.find((n) => map[n]);
  return any ? map[any] : names[0] ?? "Unknown";
}

/**
 * Routine paperwork the policy team never acts on. The Federal Register is
 * mostly this: exchange rule filings, information-collection renewals,
 * meeting notices, individual licence applications. Dropping it is the
 * difference between a dashboard and a firehose.
 *
 * These seed the watchlist as EXCLUDE entries. The live list comes from the
 * database, so a person can see every rule and switch one off.
 */
export const DEFAULT_EXCLUDES = [
  /self-regulatory organizations?/i,
  /order granting (exemptive relief|approval of a proposed rule change|petitions?)/i,
  /(agency )?information collection (activities|request)/i,
  /combined notice of filings/i,
  /sunshine act/i,
  /notice of (application|filing|intent to (grant|prepare) an? (exclusive|categorical))/i,
  /request for (nominations|membership)/i,
  /privacy act of 1974/i,
  /meeting of the/i,
  /\badvisory (committee|council)\b.*\bmeeting\b/i,
  /petitions? for reconsideration of action in rulemaking proceeding/i,
  // Paperwork Reduction Act clearances. Sweeping OMB brings in every agency's
  // form approvals, which is most of what OMB publishes and none of what a
  // policy team acts on. Dropping these is what makes the OMB sweep useful
  // rather than a second firehose.
  /submission for omb review/i,
];
/** Dockets from programmes this team does not work on. */
const OFF_TOPIC_DOCKET = /^EPA-HQ-OPP-/i;            // pesticides

/** A single company's own filing, not a policy proceeding. */
const SINGLE_PARTY = /^[A-Z][\w.,& '-]+(?:Inc\.|LLC|L\.L\.C\.|Corporation|Company|Corp\.|L\.P\.|Partners);/;

/** Everything a docket search needs: one docket, however it is titled. */
export async function fetchByDocket(docketId: string, limit = 20): Promise<FrDoc[]> {
  const u = url({
    "conditions[docket_id]": docketId,
    "fields[]": FIELDS,
    per_page: String(limit),
    order: "newest",
  });
  const res = await fetch(u, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Federal Register ${res.status}`);
  const json = (await res.json()) as { results?: FrDoc[] };
  return json.results ?? [];
}

/**
 * @param excludes title patterns from the watchlist. Defaults to the built-in
 * list so the smoke script and a fresh database still behave sensibly.
 */
export function isNoise(doc: FrDoc, excludes: RegExp[] = DEFAULT_EXCLUDES): boolean {
  const t = doc.title ?? "";
  if (excludes.some((re) => re.test(t))) return true;
  if (SINGLE_PARTY.test(t)) return true;
  if ((doc.docket_ids ?? []).some((d) => OFF_TOPIC_DOCKET.test(d))) return true;
  // A notice with no comment period is almost never work for a policy team.
  // Rules and proposals are always kept, whether or not comments are open.
  if (typeOf(doc) === "NOTICE" && !doc.comments_close_on) return true;
  return false;
}

/* ----------------------------------------------------------------- agencies */

export type FrAgency = { id: number; name: string; shortName: string | null; slug: string };

/**
 * Every agency the Federal Register publishes under — 473 of them.
 *
 * The agency sweep is keyed on the slug, and a slug a person typed from memory
 * is a watch that silently finds nothing for ever. So the picker reads the
 * real list and the person chooses from it.
 *
 * Cached for the life of the server process: the list changes when an agency
 * is created or renamed, which is not an hourly event.
 */
let agencyCache: { at: number; rows: FrAgency[] } | null = null;
const AGENCY_TTL = 12 * 60 * 60 * 1000;

export async function fetchAgencies(): Promise<FrAgency[]> {
  if (agencyCache && Date.now() - agencyCache.at < AGENCY_TTL) return agencyCache.rows;
  const res = await fetch("https://www.federalregister.gov/api/v1/agencies", {
    headers: { accept: "application/json" }, cache: "no-store",
  });
  if (!res.ok) throw new Error(`Federal Register ${res.status}`);
  const json = (await res.json()) as { id: number; name: string; short_name: string | null; slug: string | null }[];
  const rows = json
    .filter((a) => a.slug)
    .map((a): FrAgency => ({ id: a.id, name: a.name, shortName: a.short_name, slug: a.slug as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
  agencyCache = { at: Date.now(), rows };
  return rows;
}
