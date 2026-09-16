/**
 * The collector, as a one-shot process. This is what the Render cron job runs.
 *   npm run collect            → the last 30 days
 *   npm run collect -- 120     → a wider backfill on first setup
 */
import { collectFederalRegister } from "../src/lib/collect";
import { prisma } from "../src/lib/prisma";

const days = Number(process.argv[2] ?? 30);

collectFederalRegister(days)
  .then((r) => { console.log(`Federal Register: checked ${r.checked}, created ${r.created}, changed ${r.changed}`); })
  .catch((e) => { console.error("collector failed:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
