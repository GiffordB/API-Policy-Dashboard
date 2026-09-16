/**
 * The roster, parsed from CSV.
 * Three ways in, checked in this order:
 *   1. the body of a POST to /api/admin/seed  — for a deployed instance
 *   2. the ROSTER_CSV environment variable    — for a deployed instance
 *   3. data/roster.csv on disk                — for local work
 * The file on disk is git-ignored. Real names never enter the repository.
 */
export type RosterRow = {
  name: string; email: string | null; divisionId: string;
  isLead: boolean; isLitigationLead: boolean;
};

export const DIVISION_IDS = ["up", "mid", "down", "gas", "corp", "none"] as const;

export function parseRoster(csv: string): { rows: RosterRow[]; skipped: string[] } {
  const rows: RosterRow[] = [];
  const skipped: string[] = [];
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return { rows, skipped };

  // Tolerate a missing header, so a pasted block of names still works.
  const start = /(^|,)\s*name\s*(,|$)/i.test(lines[0]) ? 1 : 0;

  for (const line of lines.slice(start)) {
    const [name, email, divisionId, lead, litigation] = line.split(",").map((c) => c.trim());
    if (!name) continue;
    if (!divisionId || !DIVISION_IDS.includes(divisionId as (typeof DIVISION_IDS)[number])) {
      skipped.push(`${name}: division "${divisionId ?? ""}" is not one of ${DIVISION_IDS.join(", ")}`);
      continue;
    }
    rows.push({
      name,
      email: email || null,
      divisionId,
      isLead: lead?.toLowerCase() === "y",
      isLitigationLead: litigation?.toLowerCase() === "y",
    });
  }
  return { rows, skipped };
}
