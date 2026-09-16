import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseRoster } from "@/lib/roster";

const DIVISIONS = [
  { id: "up",   name: "Upstream",            colorVar: "var(--s1)", sortOrder: 1 },
  { id: "mid",  name: "Midstream",           colorVar: "var(--s2)", sortOrder: 2 },
  { id: "down", name: "Downstream",          colorVar: "var(--s3)", sortOrder: 3 },
  { id: "gas",  name: "Natural Gas Markets", colorVar: "var(--s4)", sortOrder: 4 },
  { id: "corp", name: "Corporate Policy",    colorVar: "var(--s5)", sortOrder: 5 },
  { id: "none", name: "Unassigned",          colorVar: "var(--muted)", sortOrder: 9 },
];

/**
 * Seeds the divisions, then the roster. Safe to run again: it upserts.
 * Send the roster CSV as the request body, or set ROSTER_CSV.
 * Nobody is ever deleted here — a person who leaves is marked inactive by hand.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.COLLECT_SECRET;
  if (!secret || req.headers.get("x-collect-secret") !== secret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  for (const d of DIVISIONS) {
    await prisma.division.upsert({ where: { id: d.id }, update: d, create: d });
  }

  const csv = (await req.text()) || process.env.ROSTER_CSV || "";
  if (!csv.trim())
    return NextResponse.json({ divisions: DIVISIONS.length, people: 0, note: "No roster sent. Post the CSV as the body, or set ROSTER_CSV." });

  const { rows, skipped } = parseRoster(csv);
  for (const r of rows) {
    await prisma.person.upsert({
      where: { name_divisionId: { name: r.name, divisionId: r.divisionId } },
      update: { email: r.email, isLead: r.isLead, isLitigationLead: r.isLitigationLead, active: true },
      create: r,
    });
  }
  return NextResponse.json({ divisions: DIVISIONS.length, people: rows.length, skipped });
}
