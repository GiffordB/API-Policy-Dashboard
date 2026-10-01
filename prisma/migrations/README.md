# Migration names

These are applied in **name order**, as plain strings — so `10_` would come
before `1_`, and a two-digit number cannot be used. `10_triage` was briefly
named that way and ran second, immediately after `0_init`: it passed only
because the table was empty and `position` was still the free-text column
`0_init` creates, so its backfill matched nothing.

Single digits 0–9 are taken. **The next migration is `9b_`, then `9c_`, and so
on.** A letter suffix sorts after `9_` because `_` (0x5F) comes before `a`
(0x61).

Renaming an applied migration is not an option: Prisma matches these directory
names against the `_prisma_migrations` table, so a rename reads as one
migration vanishing and another appearing, and `migrate deploy` refuses. That
is why the old names stay as they are.
