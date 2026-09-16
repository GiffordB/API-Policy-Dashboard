/**
 * Congress.gov API client. https://api.congress.gov/
 * One api.data.gov key covers this and Regulations.gov.
 *
 * The API has no keyword search: you fetch what changed and filter yourself.
 * So this pulls recently updated bills and the collector matches them against
 * the watchlist's terms.
 */

const BASE = "https://api.congress.gov/v3";

export type CongressBill = {
  congress: number;
  type: string;                 // HR, S, HJRES, SJRES…
  number: string;
  title: string;
  originChamber: string;        // House | Senate
  originChamberCode: string;
  updateDate: string;
  latestAction?: { actionDate: string; text: string };
  url: string;
};

function requireKey(): string {
  const key = process.env.DATA_GOV_API_KEY;
  if (!key) throw new Error("DATA_GOV_API_KEY is not set — get one free at https://api.data.gov/signup/");
  return key;
}

/**
 * Every bill updated since `since` (an ISO timestamp), newest first.
 * Capped by `maxPages` so one run cannot walk the whole Congress.
 */
export async function fetchRecentBills(since: string, maxPages = 8): Promise<CongressBill[]> {
  const key = requireKey();
  const out: CongressBill[] = [];
  const limit = 250;

  for (let page = 0; page < maxPages; page++) {
    const u = new URL(`${BASE}/bill`);
    u.searchParams.set("api_key", key);
    u.searchParams.set("format", "json");
    u.searchParams.set("fromDateTime", since);
    u.searchParams.set("sort", "updateDate+desc");
    u.searchParams.set("limit", String(limit));
    u.searchParams.set("offset", String(page * limit));

    const res = await fetch(u, { headers: { accept: "application/json" }, cache: "no-store" });
    if (res.status === 429) throw new Error("Congress.gov rate limit reached — the key allows 1,000 requests an hour.");
    if (!res.ok) throw new Error(`Congress.gov ${res.status} ${res.statusText}`);

    const json = (await res.json()) as { bills?: CongressBill[] };
    const bills = json.bills ?? [];
    out.push(...bills);
    if (bills.length < limit) break;
  }
  return out;
}

/** "H.R. 4412 · 119th Congress" — how a person cites it. */
export function billId(b: CongressBill): string {
  const pretty: Record<string, string> = {
    HR: "H.R.", S: "S.", HJRES: "H.J. Res.", SJRES: "S.J. Res.",
    HCONRES: "H. Con. Res.", SCONRES: "S. Con. Res.", HRES: "H. Res.", SRES: "S. Res.",
  };
  const t = pretty[b.type?.toUpperCase()] ?? b.type;
  return `${t} ${b.number} · ${b.congress}th Congress`;
}

/**
 * Where a bill has reached, read from its latest action.
 *
 * The API gives no stage field, only the text of the last thing that happened,
 * so this reads that text. It is a summary, not a parliamentary record: when
 * the wording is unfamiliar it says Committee rather than inventing a stage.
 */
export function stageFor(b: CongressBill): { stage: string; stageIndex: number } {
  const t = (b.latestAction?.text ?? "").toLowerCase();
  if (/became public law|signed by president/.test(t)) return { stage: "Enacted", stageIndex: 5 };
  if (/presented to president|cleared for white house/.test(t)) return { stage: "Enrolled", stageIndex: 4 };
  if (/received in the (senate|house)|held at the desk/.test(t)) return { stage: "Other chamber", stageIndex: 3 };
  if (/passed\/agreed to|passed (house|senate)|on passage/.test(t)) return { stage: "Floor", stageIndex: 2 };
  if (/placed on .*calendar|cloture|motion to proceed/.test(t)) return { stage: "Floor", stageIndex: 2 };
  if (/reported|ordered to be reported|markup|committee consideration/.test(t)) return { stage: "Committee", stageIndex: 1 };
  if (/referred to/.test(t)) return { stage: "Committee", stageIndex: 1 };
  if (/introduced|sponsor introductory/.test(t)) return { stage: "Introduced", stageIndex: 0 };
  return { stage: "Committee", stageIndex: 1 };
}

/** The public page a person can actually read. */
export function publicUrl(b: CongressBill): string {
  const slug: Record<string, string> = {
    HR: "house-bill", S: "senate-bill",
    HJRES: "house-joint-resolution", SJRES: "senate-joint-resolution",
    HCONRES: "house-concurrent-resolution", SCONRES: "senate-concurrent-resolution",
    HRES: "house-resolution", SRES: "senate-resolution",
  };
  const s = slug[b.type?.toUpperCase()] ?? "house-bill";
  return `https://www.congress.gov/bill/${b.congress}th-congress/${s}/${b.number}`;
}
