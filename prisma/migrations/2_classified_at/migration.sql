-- When the classifier last looked at this record, whether or not it filed it.
-- Without this, every run re-reads and re-bills the records it already judged
-- and could not place.
ALTER TABLE "Item" ADD COLUMN "classifiedAt" TIMESTAMP(3);
