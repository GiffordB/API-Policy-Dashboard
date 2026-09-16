# Policy Radar

Regulatory and legislative tracking for a policy team. Watcher agents read the
public sources on a schedule; the dashboard shows what changed, what closes
soon, and who owns it.

The page is organised around five policy divisions — Upstream, Midstream,
Downstream, Natural Gas Markets and Corporate Policy — plus an **Unassigned**
bucket for records the collectors could not confidently route.

## What works today

- **Federal Register collector.** Live, no API key. Runs on a schedule, creates
  items it has not seen, and writes a finding for anything that moved: a stage
  change, a new or extended comment deadline, an effective date.
- **48-hour band.** Comment periods closing inside two days, at the top of the
  page. Membership is decided by time alone. Priority decides the order inside it.
- **Editing.** Priority, department and owner, all with an audit trail. The
  owner list follows the department, so moving an item clears an owner who is
  not on the new roster.
- **Add a reg the collectors missed.** Paste a Federal Register number or a URL
  and it fills the record, or search by words in the title.

## What does not work yet

| Source | State |
|---|---|
| Federal Register | live |
| Regulations.gov (dockets, filed comments) | needs `DATA_GOV_API_KEY` |
| Congress.gov (bills) | needs `DATA_GOV_API_KEY` |
| Open States (state bills) | needs `OPENSTATES_API_KEY` |
| CourtListener (dockets) | needs `COURTLISTENER_TOKEN` |
| OIRA / EO 12866 pipeline | not written |
| Division analyst agents | not written |

**Division routing is keyword-based and it is not very good.** About a third of
incoming records route confidently; the rest land in Unassigned for a human to
file. That is deliberate — a wrong division is worse than an honest blank. The
real fix is an LLM classifier reading the title and abstract, which is the first
analyst agent to write.

## Setup

```bash
cp .env.example .env          # fill in DATABASE_URL at minimum
npm install
npm run db:push               # create the tables
npm run seed                  # divisions, then the roster
npm run collect -- 60         # pull 60 days from the Federal Register
npm run dev
```

### The staff roster

`data/roster.csv` holds real names and is **git-ignored on purpose**. Copy
`data/roster.example.csv`, replace the rows, and run `npm run seed`. The seed
falls back to the example file so a fresh checkout still runs.

```csv
name,email,division,lead,litigation
Jane Doe,jane@example.org,up,y,
```

`division` is one of `up`, `mid`, `down`, `gas`, `corp`. `lead` marks the
division lead. `litigation` marks who owns court items in that division.

### Checking the collector without a database

```bash
npm run smoke -- 14
```

Hits the live Federal Register and prints what a run would create, how much
routine paperwork it dropped, and how many records it could not route. Use it
whenever you change the agency list or the routing rules.

## Deploying

**The app → Vercel.** Import the repo, set `DATABASE_URL`, `APP_PASSWORD` and
`COLLECT_SECRET`. Build command is `npm run build` (it runs `prisma generate`).

**The database and the collectors → Render.** `render.yaml` declares a Postgres
instance and a cron job that runs `npm run collect` every 30 minutes. The
collectors live on Render because Vercel's Hobby plan allows one cron run a day,
and the Federal Register watcher needs to run far more often than that.

Point Vercel's `DATABASE_URL` at the same Render database.

## Access, and what the audit trail actually proves

`APP_PASSWORD` is one shared password. It keeps the pilot off the open web. It
is **not** identity: the "acting as" picker in the header is a convention, so
the audit trail records who *said* they made a change, not who did.

Replace both with your identity provider before anyone relies on that trail.
Until then, treat it as a working record, not as evidence.

## Layout

```
prisma/schema.prisma     items, divisions, people, findings, audit, agent runs
src/lib/sources/         one file per external source
src/lib/routing.ts       which division owns an incoming record
src/lib/collect.ts       one collector run: fetch, diff, write findings
src/app/api/             items (edit, add), lookup, collect
src/components/          the dashboard
scripts/collect.ts       what the Render cron job runs
scripts/smoke.ts         live source check, no database needed
```

### A rule the collector must keep

A collector never overwrites a human's priority, division or owner. It owns the
title, stage, dates and source fields. Everything a person decided stays theirs.
