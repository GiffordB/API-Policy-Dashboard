# Policy Radar

Regulatory and legislative tracking for a policy team. Watcher agents read the
public sources on a schedule; the dashboard shows what changed, what closes
soon, and who owns it.

The page is organised around five policy divisions — Upstream, Midstream,
Downstream, Natural Gas Markets and Corporate Policy — plus an **Unassigned**
bucket for records the collectors could not confidently route.

## Pages

One page per track, because a policy team works one at a time and a page can be
bookmarked and sent to a colleague:

| Path | What it holds |
|---|---|
| `/regulatory` | Federal agency rulemaking |
| `/congress` | Bills and resolutions |
| `/states` | State legislatures |
| `/coverage` | What the collectors look for |

`/` redirects to `/regulatory`. Opening an item that lives on another track
navigates there and opens it, rather than dropping you on that page's first row.

## The coverage page

`/coverage` is the answer to "what do we actually scrape the federal sites for".

It lists, as live records rather than as constants in source:

- **Agencies swept** — every document these agencies publish is read each run.
- **Terms we always search** — searched across the whole Federal Register,
  including agencies not on the swept list. This is how something outside the
  usual sources still reaches you.
- **Dockets we follow** — pinned by number, followed whatever the documents in
  them are titled. Exclusion patterns never apply to a pinned docket.
- **Dropped on purpose** — the noise patterns, each with a plain reason. Two
  thirds of the Federal Register is routine paperwork; this is where you can
  see exactly what is being thrown away and switch a rule off.

Each row shows what it found on the last run and how many held records it
brought in, so a term has to earn its place. Nothing is deleted — pausing an
entry stops future runs using it and keeps the record of what it found.

When a dashboard search finds nothing, the empty state offers two things: search
the Federal Register for it now, or watch for it from now on.

## What works today

- **Federal Register collector.** Live, no API key. Runs on a schedule, creates
  items it has not seen, and writes a finding for anything that moved: a stage
  change, a new or extended comment deadline, an effective date.
- **48-hour band.** Comment periods closing inside two days, at the top of the
  page. Membership is decided by time alone. Priority decides the order inside it.
  A window that has already shut never appears — "open" is derived from the date
  on every read, never from a stored flag that can go stale.
- **Retention.** A record whose comment window shut more than a year ago, and
  which nobody ever set a position or priority on, is archived out of every
  view. Archived, not deleted: a rule can go quiet for a year and come back as
  litigation. Anything a person touched is left alone, because that is someone
  saying it still matters.
- **Editing.** Priority, department, owner and position, all with an audit
  trail. The owner list follows the department, so moving an item clears an
  owner who is not on the new roster.
- **Position.** Support, Oppose, Amend or Monitor, with a one-line reason and
  the name of whoever set it. A position is deliberately not colour-coded — red,
  amber and green mean the clock, and the priority ramp means rank. The only
  position that raises its voice is the missing one: an open comment window with
  no position shows as **Position needed**, and the dashboard counts them.
- **Add a reg the collectors missed.** Paste a Federal Register number or a URL
  and it fills the record, or search by words in the title.

## What does not work yet

| Source | State |
|---|---|
| Federal Register | live |
| Congress.gov (bills) | live |
| Regulations.gov (filed comments) | live |
| Open States (state bills) | **paused** — `STATES_ENABLED=1` resumes the daily sweep |
| OIRA / EO 12866 pipeline | not written |
| Division analyst agents | not written |

### Division routing, in two passes

**Pass one is keyword rules** (`src/lib/routing.ts`), run by the collector. On a
real 60-day pull it filed about 40% of records. The rest land in **Unassigned**,
because a wrong division is worse than an honest blank — a wrong one looks filed
and nobody checks it again.

**Pass two is the classifier** (`src/lib/classify.ts`), which reads the
Unassigned pile and files what it can. It needs `ANTHROPIC_API_KEY`.

```bash
curl -X POST "https://YOUR-APP.vercel.app/api/admin/classify?limit=60" \
  -H "x-collect-secret: $COLLECT_SECRET"
```

Three rules make it safe to run unattended:

1. It only reads items in Unassigned. A division a person chose is never touched.
2. Low confidence means it leaves the item alone.
3. It writes its reasoning into the item's findings, so a bad call can be seen
   and corrected rather than argued about.

It re-reads each item immediately before writing, so a person filing an item by
hand while a batch is in flight always wins.

## Setup, locally

```bash
cp .env.example .env          # fill in DATABASE_URL at minimum
npm install
npm run db:deploy             # apply the migration
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

### Checking what the server actually has

```bash
curl https://YOUR-APP.vercel.app/api/admin/status -H "x-collect-secret: $COLLECT_SECRET"
```

Reports which environment variables the running server can see — presence only,
never values — plus record counts and the last five agent runs. A Vercel
environment variable only reaches a **new** deployment, so "saved in the
dashboard" and "visible to the server" are different facts. This reports the
second one, which is the one that matters.

### Checking the collector without a database

```bash
npm run smoke -- 14
```

Hits the live Federal Register and prints what a run would create, how much
routine paperwork it dropped, and how many records it could not route. Use it
whenever you change the agency list or the routing rules.

## Deploying

**The app → Vercel.** Import the repo and set `DATABASE_URL`, `APP_PASSWORD`
and `COLLECT_SECRET`. The build command runs `prisma migrate deploy`, so the
first deploy creates the tables by itself. You never need a database shell.

Then seed and collect over HTTP:

```bash
# divisions and the roster. Send the CSV as the body.
curl -X POST https://YOUR-APP.vercel.app/api/admin/seed \
  -H "x-collect-secret: $COLLECT_SECRET" \
  --data-binary @data/roster.csv

# the first collection
curl -X POST "https://YOUR-APP.vercel.app/api/collect?days=60" \
  -H "x-collect-secret: $COLLECT_SECRET"
```

Both are safe to run again. The seed upserts, and the collector only writes
what changed.

**The collectors → Render.** `render.yaml` declares a cron job that runs
`npm run collect -- 3` every hour. The collectors live on Render because
Vercel's Hobby plan allows one cron run a day, and the Federal Register watcher
needs to run more often than that.

**Create the database outside the blueprint**, and set `DATABASE_URL` on both
Vercel and the Render job by hand. The blueprint deliberately does not declare a
database: a blueprint-managed `fromDatabase` binding is re-applied on every sync
and silently overwrites the value set in the dashboard, which is how you end up
with the app on one database and the collector on another.

Both the app and the job print the database they connected to — host and name
only, never credentials. If those two lines differ, that is the bug:

```bash
curl https://YOUR-APP.vercel.app/api/admin/status -H "x-collect-secret: $COLLECT_SECRET"
# → "database": "dpg-….ohio-postgres.render.com/policy_radar_xxxx"
```

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
