-- Inbox and tracking.
--
-- Everything a collector finds now arrives in an inbox and waits for a person.
-- Without this the dashboard could not answer the first question anybody asks
-- of it: which of these has nobody looked at yet.
CREATE TYPE "Triage" AS ENUM ('INBOX', 'TRACKED');

ALTER TABLE "Item" ADD COLUMN "triage" "Triage" NOT NULL DEFAULT 'INBOX';
ALTER TABLE "Item" ADD COLUMN "triagedBy" TEXT;
ALTER TABLE "Item" ADD COLUMN "triagedAt" TIMESTAMP(3);

-- The backfill. A record somebody has already acted on is reviewed by
-- definition, so it starts tracked rather than landing in a 400-item inbox on
-- the first morning: a position chosen, a priority confirmed, or an owner
-- assigned is all a person saying this one matters. Everything else is
-- genuinely un-reviewed and belongs in the inbox, which is the point.
UPDATE "Item"
   SET "triage" = 'TRACKED',
       "triagedBy" = 'before the inbox existed',
       "triagedAt" = "updatedAt"
 WHERE "position" <> 'PENDING'
    OR "priorityConfirmed" = true
    OR "ownerId" IS NOT NULL;

CREATE INDEX "Item_triage_commentDueAt_idx" ON "Item"("triage", "commentDueAt");
