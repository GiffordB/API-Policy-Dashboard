-- "Do not track": one docket a person decided is not worth carrying.
--
-- The item itself is deleted, so a marker has to outlive it, or the next
-- collector run would find the same document and put it straight back. The
-- marker is a watchlist row, which means it shows on the coverage page beside
-- everything else we do and do not look for.
--
-- Alone in its own migration: Postgres will not let a new enum value be added
-- and used inside the same transaction.
ALTER TYPE "WatchKind" ADD VALUE IF NOT EXISTS 'BLOCK';
