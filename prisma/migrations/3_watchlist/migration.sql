-- The watchlist: what the collectors look for, as data rather than as source code.
CREATE TYPE "WatchKind" AS ENUM ('AGENCY', 'TERM', 'DOCKET', 'EXCLUDE');

CREATE TABLE "Watch" (
    "id" TEXT NOT NULL,
    "kind" "WatchKind" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "source" "SourceKind" NOT NULL DEFAULT 'FEDERAL_REGISTER',
    "divisionId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "addedBy" TEXT NOT NULL DEFAULT 'setup',
    "lastRunAt" TIMESTAMP(3),
    "lastHits" INTEGER NOT NULL DEFAULT 0,
    "totalHits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Watch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Watch_kind_value_key" ON "Watch"("kind", "value");
CREATE INDEX "Watch_active_kind_idx" ON "Watch"("active", "kind");

ALTER TABLE "Watch" ADD CONSTRAINT "Watch_divisionId_fkey"
    FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Which watch first brought a record in, so the coverage page can prove its worth.
ALTER TABLE "Item" ADD COLUMN "foundByWatchId" TEXT;
ALTER TABLE "Item" ADD CONSTRAINT "Item_foundByWatchId_fkey"
    FOREIGN KEY ("foundByWatchId") REFERENCES "Watch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
