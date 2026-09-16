-- Position becomes a real field a person assigns, not free text nobody could edit.
--
-- The old text column is dropped rather than converted: there was no way to set
-- a position in the interface, so every row holds either NULL or the literal
-- "Position pending". Nothing is lost.
CREATE TYPE "Position" AS ENUM ('PENDING', 'SUPPORT', 'OPPOSE', 'AMEND', 'MONITOR');

ALTER TABLE "Item" DROP COLUMN "position";
ALTER TABLE "Item" ADD COLUMN "position" "Position" NOT NULL DEFAULT 'PENDING';

-- A position without a reason is an opinion. These carry the reason and the name.
ALTER TABLE "Item" ADD COLUMN "positionNote" TEXT;
ALTER TABLE "Item" ADD COLUMN "positionSetBy" TEXT;
ALTER TABLE "Item" ADD COLUMN "positionSetAt" TIMESTAMP(3);

CREATE INDEX "Item_position_idx" ON "Item"("position");
