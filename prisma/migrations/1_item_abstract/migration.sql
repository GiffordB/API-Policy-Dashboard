-- The agency's own summary of the document. The single most useful field for
-- deciding which division owns a record, and the classifier was working without it.
ALTER TABLE "Item" ADD COLUMN "abstract" TEXT;
