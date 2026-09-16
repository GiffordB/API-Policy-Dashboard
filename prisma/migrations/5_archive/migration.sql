-- Records whose comment window closed long ago and that nobody ever touched.
-- Archived rather than deleted: a policy team's history is worth more than the
-- disk it sits on, and an archived record can come back.
ALTER TABLE "Item" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Item" ADD COLUMN "archivedReason" TEXT;
CREATE INDEX "Item_archivedAt_idx" ON "Item"("archivedAt");
