/**
 * Seeds the five divisions, then the staff roster from data/roster.csv.
 * The roster file is git-ignored on purpose: real names stay out of the repo.
 * Falls back to data/roster.example.csv so a fresh checkout still runs.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DIVISIONS = [
  { id: "up",   name: "Upstream",            colorVar: "var(--s1)", sortOrder: 1 },
  { id: "mid",  name: "Midstream",           colorVar: "var(--s2)", sortOrder: 2 },
  { id: "down", name: "Downstream",          colorVar: "var(--s3)", sortOrder: 3 },
  { id: "gas",  name: "Natural Gas Markets", colorVar: "var(--s4)", sortOrder: 4 },
  { id: "corp", name: "Corporate Policy",    colorVar: "var(--s5)", sortOrder: 5 },
  // Not a division. Where a collector could not tell, so a human must look.
  { id: "none", name: "Unassigned",          colorVar: "var(--muted)", sortOrder: 9 },
];

function rosterPath() {
  const real = join(process.cwd(), "data", "roster.csv");
  const example = join(process.cwd(), "data", "roster.example.csv");
  if (existsSync(real)) return { path: real, real: true };
  return { path: example, real: false };
}

async function main() {
  for (const d of DIVISIONS) {
    await prisma.division.upsert({ where: { id: d.id }, update: d, create: d });
  }
  console.log(`divisions: ${DIVISIONS.length}`);

  const { path, real } = rosterPath();
  if (!real) console.warn("No data/roster.csv found — seeding example names instead.");

  const rows = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .slice(1) // header
    .map((l) => l.split(",").map((c) => c.trim()));

  let n = 0;
  for (const [name, email, divisionId, lead, litigation] of rows) {
    if (!name || !divisionId) continue;
    if (!DIVISIONS.some((d) => d.id === divisionId)) {
      console.warn(`skipped "${name}": unknown division "${divisionId}"`);
      continue;
    }
    await prisma.person.upsert({
      where: { name_divisionId: { name, divisionId } },
      update: { email: email || null, isLead: lead === "y", isLitigationLead: litigation === "y" },
      create: {
        name, email: email || null, divisionId,
        isLead: lead === "y", isLitigationLead: litigation === "y",
      },
    });
    n++;
  }
  console.log(`people: ${n}${real ? "" : " (examples)"}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
