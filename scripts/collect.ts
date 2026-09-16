/**
 * The collector, as a one-shot process. This is what the Render cron job runs.
 *
 *   npm run collect          → the last 3 days, the right window for an hourly job
 *   npm run collect -- 60    → a wider one-off backfill
 *
 * Set CLASSIFY_AFTER_COLLECT=1 to file new arrivals in the same run. It is
 * capped, so an unexpected flood of records cannot run up a bill unattended.
 */
import { collectFederalRegister } from "../src/lib/collect";
import { classifyUnassigned } from "../src/lib/classify";
import { prisma } from "../src/lib/prisma";
import { whichDatabase } from "../src/lib/db-label";

const days = Number(process.argv[2] ?? 3);
const CLASSIFY_CAP = Number(process.env.CLASSIFY_CAP ?? 25);

async function main() {
  console.log(`database: ${whichDatabase()}`);

  // A job pointed at the wrong database fails deep inside Prisma with a missing
  // table. Say so here instead, in a sentence that names the cause.
  const ready = await prisma.division.count().catch(() => null);
  if (ready === null) {
    throw new Error(
      `This database has no Policy Radar tables. The job is pointed at the wrong one. ` +
      `Copy DATABASE_URL from the Vercel project, which is the database the app uses.`
    );
  }
  if (ready === 0) {
    throw new Error(
      `This database has tables but no divisions. Run the seed endpoint before collecting.`
    );
  }

  const r = await collectFederalRegister(days);
  console.log(
    `Federal Register (${days}d): checked ${r.checked}, created ${r.created}, ` +
    `changed ${r.changed}, unchanged ${r.skipped}`
  );

  if (process.env.CLASSIFY_AFTER_COLLECT !== "1") return;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("CLASSIFY_AFTER_COLLECT is on but ANTHROPIC_API_KEY is not set — skipping.");
    return;
  }
  const c = await classifyUnassigned(CLASSIFY_CAP);
  console.log(`Classifier: checked ${c.checked}, filed ${c.filed}, ghosted ${c.ghosted}, left ${c.leftAlone}`);
}

main()
  .catch((e) => { console.error("collector failed:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
