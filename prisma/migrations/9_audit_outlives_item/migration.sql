-- The audit trail must survive the record it describes.
--
-- Audit rows cascaded away with the item, which was harmless while nothing
-- deleted an item. "Do not track" does. Cutting the link instead of following
-- it keeps the history: who set what, and who decided to stop tracking it.
ALTER TABLE "Audit" DROP CONSTRAINT IF EXISTS "Audit_itemId_fkey";
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
