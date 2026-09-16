-- How many comments have actually been filed on a docket, and by whom.
-- "Comments due in 9 days" is a deadline. "Comments due in 9 days, 312 filed"
-- is an argument you are already losing or winning.
ALTER TABLE "Item" ADD COLUMN "commentCount" INTEGER;
ALTER TABLE "Item" ADD COLUMN "commentsCheckedAt" TIMESTAMP(3);
ALTER TABLE "Item" ADD COLUMN "recentCommenters" JSONB;
CREATE INDEX "Item_commentsCheckedAt_idx" ON "Item"("commentsCheckedAt");
