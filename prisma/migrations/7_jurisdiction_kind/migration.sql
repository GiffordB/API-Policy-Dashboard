-- State legislatures are watched the way agencies are, but they are not
-- agencies. Alone in its own migration: Postgres will not let a new enum value
-- be added and used inside the same transaction.
ALTER TYPE "WatchKind" ADD VALUE IF NOT EXISTS 'JURISDICTION';
