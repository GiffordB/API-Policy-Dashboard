/**
 * Open States v3. https://v3.openstates.org/
 * Free key from https://open.pluralpolicy.com/accounts/profile/
 *
 * The useful surprise here: `q` searches every state at once. A term costs one
 * request rather than fifty, which matters — the free tier is a few hundred
 * requests a day, not a few thousand an hour.
 */

const BASE = "https://v3.openstates.org";

export type StateBill = {
  id: string;
  identifier: string;                    // "HB 3391"
  title: string;
  session: string;
  jurisdiction?: { name?: string; classification?: string };
  from_organization?: { name?: string; classification?: string };
  classification?: string[];
  subject?: string[];
  latest_action_date?: string;
  latest_action_description?: string;
  openstates_url?: string;
  updated_at?: string;
};

function requireKey(): string {
  const key = process.env.OPENSTATES_API_KEY;
  if (!key) throw new Error("OPENSTATES_API_KEY is not set — free key at https://open.pluralpolicy.com/accounts/profile/");
  return key;
}

/**
 * Bills in any state whose text matches `term` and that have moved since
 * `actionSince` (YYYY-MM-DD). Newest action first, capped by `maxPages`.
 */
export async function searchBills(term: string, actionSince: string, maxPages = 3): Promise<StateBill[]> {
  const key = requireKey();
  const out: StateBill[] = [];
  const perPage = 20;                     // the API's ceiling

  for (let page = 1; page <= maxPages; page++) {
    const u = new URL(`${BASE}/bills`);
    u.searchParams.set("q", term);
    u.searchParams.set("action_since", actionSince);
    u.searchParams.set("sort", "updated_desc");
    u.searchParams.set("per_page", String(perPage));
    u.searchParams.set("page", String(page));

    const res = await fetch(u, {
      headers: { "x-api-key": key, accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 429) throw new Error("Open States rate limit reached — the free key allows a few hundred requests a day.");
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`Open States ${res.status} ${res.statusText}`);

    const json = (await res.json()) as { results?: StateBill[] };
    const results = json.results ?? [];
    out.push(...results);
    if (results.length < perPage) break;
  }
  return out;
}

/** "HB 3391 · Texas 2025-2026" — how a state bill is cited in a memo. */
export function billId(b: StateBill): string {
  const where = b.jurisdiction?.name ?? "Unknown";
  return `${b.identifier} · ${where} ${b.session}`;
}

/**
 * Where a bill has reached, read from its latest action.
 *
 * Fifty legislatures, fifty vocabularies. This reads the common wording and
 * falls back to Committee rather than inventing a stage it cannot support.
 */
export function stageFor(b: StateBill): { stage: string; stageIndex: number } {
  const t = (b.latest_action_description ?? "").toLowerCase();
  if (/signed by governor|chaptered|became law|enacted/.test(t)) return { stage: "Enacted", stageIndex: 5 };
  if (/sent to governor|presented to governor|enrolled|delivered to governor/.test(t)) return { stage: "Enrolled", stageIndex: 4 };
  if (/received (in|from) (the )?(house|senate)|first reading.*(house|senate)/.test(t)) return { stage: "Other chamber", stageIndex: 3 };
  if (/passed|third reading|floor|placed on calendar/.test(t)) return { stage: "Floor", stageIndex: 2 };
  if (/died|postponed indefinitely|failed|withdrawn|vetoed/.test(t)) return { stage: "Introduced", stageIndex: 0 };
  if (/committee|referred|reported|hearing/.test(t)) return { stage: "Committee", stageIndex: 1 };
  if (/introduced|filed|prefiled|first reading/.test(t)) return { stage: "Introduced", stageIndex: 0 };
  return { stage: "Committee", stageIndex: 1 };
}
