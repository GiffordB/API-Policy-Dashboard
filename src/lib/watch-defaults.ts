import { SourceKind, WatchKind } from "@prisma/client";
import { DEFAULT_AGENCIES, DEFAULT_EXCLUDES } from "@/lib/sources/federal-register";

/** Readable names for the agency slugs the Federal Register uses. */
const AGENCY_LABEL: Record<string, string> = {
  "environmental-protection-agency": "EPA",
  "pipeline-and-hazardous-materials-safety-administration": "PHMSA",
  "federal-energy-regulatory-commission": "FERC",
  "land-management-bureau": "BLM",
  "ocean-energy-management-bureau": "BOEM",
  "safety-and-environmental-enforcement-bureau": "BSEE",
  "energy-department": "Department of Energy",
  "internal-revenue-service": "IRS",
  "securities-and-exchange-commission": "SEC",
  "occupational-safety-and-health-administration": "OSHA",
  "industry-and-security-bureau": "Commerce / BIS",
  "commodity-futures-trading-commission": "CFTC",
};

const AGENCY_DIVISION: Record<string, string> = {
  "pipeline-and-hazardous-materials-safety-administration": "mid",
  "land-management-bureau": "up",
  "ocean-energy-management-bureau": "up",
  "safety-and-environmental-enforcement-bureau": "up",
  "occupational-safety-and-health-administration": "down",
  "commodity-futures-trading-commission": "gas",
  "internal-revenue-service": "corp",
  "securities-and-exchange-commission": "corp",
  "industry-and-security-bureau": "corp",
};

/** A plain-English reason for each exclusion, so the coverage page can justify it. */
const EXCLUDE_LABEL: [RegExp, string, string][] = [
  [/self-regulatory organizations?/i, "Exchange rule filings", "SEC filings by Nasdaq, NYSE and the like. Thousands a year, none of them ours."],
  [/order granting/i, "Routine SEC approval orders", "Approvals of those same exchange filings."],
  [/information collection/i, "Paperwork Act renewals", "Renewals of existing reporting forms, not new policy."],
  [/combined notice of filings/i, "FERC combined filing notices", "Daily lists of individual company filings."],
  [/sunshine act/i, "Sunshine Act meeting notices", "Notices that a commission will meet."],
  [/notice of \(application\|filing/i, "Single licence applications", "One company's own application."],
  [/request for \(nominations\|membership/i, "Committee nominations", "Calls for advisory committee members."],
  [/privacy act of 1974/i, "Privacy Act system notices", "Agency records-system housekeeping."],
  [/meeting of the/i, "Meeting announcements", "Advisory committee meeting dates."],
  [/advisory \(committee\|council/i, "Advisory committee notices", "Advisory body housekeeping."],
  [/petitions? for reconsideration/i, "Reconsideration petitions", "Procedural filings in other agencies' proceedings."],
];

export function defaultWatches() {
  const agencies = (DEFAULT_AGENCIES as unknown as string[]).map((slug) => ({
    kind: WatchKind.AGENCY,
    value: slug,
    label: AGENCY_LABEL[slug] ?? slug,
    note: "Every rule, proposal and notice this agency publishes is swept.",
    source: SourceKind.FEDERAL_REGISTER,
    divisionId: AGENCY_DIVISION[slug] ?? null,
  }));

  const excludes = DEFAULT_EXCLUDES.map((re) => {
    const src = re.source;
    const match = EXCLUDE_LABEL.find(([r]) => r.source === src);
    return {
      kind: WatchKind.EXCLUDE,
      value: src,
      label: match?.[1] ?? src,
      note: match?.[2] ?? "Routine paperwork, dropped before it reaches the dashboard.",
      source: SourceKind.FEDERAL_REGISTER,
      divisionId: null,
    };
  });

  // Starter terms. These reach beyond the agency sweep, which is the point.
  //
  // Two vocabularies, deliberately. A rulemaking is titled in programme language
  // ("Class VI injection wells"); a bill is titled in political language ("the
  // Natural Gas Tax Repeal Act"). A term list written for one finds nothing in
  // the other — the first Congress run checked 854 bills and matched none.
  const terms = [
    ["class VI injection well", "Class VI injection wells", "Carbon sequestration wells, wherever they are published. The bare phrase \u201cclass VI\u201d also matches FDA device classes, so the term is narrowed.", "up"],
    ["hydraulic fracturing", "Hydraulic fracturing", null, "up"],
    ["liquefied natural gas", "LNG", null, "gas"],
    ["pipeline safety", "Pipeline safety", null, "mid"],
    ["petroleum refinery", "Refineries", null, "down"],

    // Bill-title language. Broader on purpose: the classifier is the second
    // gate, so a wide net here costs a little filing and misses less.
    ["oil and gas", "Oil and gas (bills)", "Bill titles rarely use programme language.", "up"],
    ["natural gas", "Natural gas (bills)", null, "gas"],
    ["pipeline", "Pipelines (bills)", null, "mid"],
    ["crude oil", "Crude oil (bills)", null, "down"],
    ["methane", "Methane (bills)", null, "up"],
    ["offshore", "Offshore (bills)", "Also catches offshore wind; the classifier sorts it out.", "up"],
    ["refinery", "Refineries (bills)", null, "down"],
    ["permitting", "Permitting (bills)", null, "corp"],
    ["energy security", "Energy security (bills)", null, "corp"],
  ].map(([value, label, note, dv]) => ({
    kind: WatchKind.TERM,
    value: value as string,
    label: label as string,
    note: (note as string | null) ?? null,
    source: SourceKind.FEDERAL_REGISTER,
    divisionId: dv as string,
  }));

  // The state legislatures an energy trade association actually reads. Open
  // States searches all fifty in one request; this decides which are kept.
  const jurisdictions = [
    ["Texas", "up"], ["New Mexico", "up"], ["Oklahoma", "up"], ["North Dakota", "up"],
    ["Wyoming", "up"], ["Alaska", "up"], ["Louisiana", "gas"], ["Pennsylvania", "up"],
    ["Ohio", "mid"], ["West Virginia", "mid"], ["Colorado", "up"], ["California", "down"],
  ].map(([name, dv]) => ({
    kind: WatchKind.JURISDICTION,
    value: name as string,
    label: name as string,
    note: null as string | null,
    source: SourceKind.OPEN_STATES,
    divisionId: dv as string,
  }));

  return [...agencies, ...terms, ...jurisdictions, ...excludes];
}
