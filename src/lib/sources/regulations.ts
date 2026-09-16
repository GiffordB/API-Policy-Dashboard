/**
 * Regulations.gov v4. https://open.gsa.gov/api/regulationsgov/
 * Same api.data.gov key as Congress.gov. Authenticated with an X-Api-Key header.
 *
 * This is the only source that says what is actually being FILED, rather than
 * what an agency has published. A deadline tells you when the argument closes;
 * the comment count tells you whether anyone is making it.
 */

const BASE = "https://api.regulations.gov/v4";

/** Regulations.gov docket numbers look like EPA-HQ-OAR-2026-0177 or PHMSA-2025-0071. */
export const DOCKET_PATTERN = /^[A-Z]{2,6}(?:-[A-Z0-9]{1,8})*-\d{4}-\d{3,5}$/;

export type CommentSummary = {
  total: number;
  recent: { submitter: string; postedDate: string; title: string }[];
};

function requireKey(): string {
  const key = process.env.DATA_GOV_API_KEY;
  if (!key) throw new Error("DATA_GOV_API_KEY is not set — the same key covers Congress.gov.");
  return key;
}

type CommentItem = {
  id: string;
  attributes?: {
    title?: string;
    postedDate?: string;
    // The API calls the filer's name different things depending on the form used.
    organization?: string;
    firstName?: string;
    lastName?: string;
    submitterName?: string;
  };
};

function nameOf(c: CommentItem): string {
  const a = c.attributes ?? {};
  const person = [a.firstName, a.lastName].filter(Boolean).join(" ").trim();
  return a.organization || a.submitterName || person || "Anonymous";
}

/**
 * The comment count for one docket, plus the five most recent filers.
 *
 * One request does both: page[size]=5 returns the newest five, and
 * meta.totalElements returns how many there are altogether. That matters —
 * this runs once per open docket, against a key limited by the hour.
 */
export async function fetchCommentSummary(docketId: string): Promise<CommentSummary | null> {
  const u = new URL(`${BASE}/comments`);
  u.searchParams.set("filter[docketId]", docketId);
  u.searchParams.set("sort", "-postedDate");
  u.searchParams.set("page[size]", "5");

  const res = await fetch(u, {
    headers: { "X-Api-Key": requireKey(), accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (res.status === 429) throw new Error("Regulations.gov rate limit reached — the key allows 500 requests an hour.");
  if (!res.ok) throw new Error(`Regulations.gov ${res.status} ${res.statusText}`);

  const json = (await res.json()) as {
    data?: CommentItem[];
    meta?: { totalElements?: number };
  };

  return {
    total: json.meta?.totalElements ?? json.data?.length ?? 0,
    recent: (json.data ?? []).map((c) => ({
      submitter: nameOf(c),
      postedDate: c.attributes?.postedDate?.slice(0, 10) ?? "",
      title: (c.attributes?.title ?? "").slice(0, 140),
    })),
  };
}

/** The page a person can open to read the comments themselves. */
export const docketUrl = (docketId: string) =>
  `https://www.regulations.gov/docket/${encodeURIComponent(docketId)}/comments`;
