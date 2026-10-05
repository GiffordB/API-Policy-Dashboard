# Merge plan: State Legislative Tracker (A) + Policy Tracker (B)

Status: **draft for approval. No code is changed by this plan.**
Written in ASD-STE100 (Simplified Technical English). Date: 2026-10-05.

- **Project A** — State Legislative Tracker: `GiffordB/state-legislative-tracker`.
- **Project B** — Policy Tracker ("Policy Radar"): `GiffordB/API-Policy-Dashboard`.

The user confirmed these two projects on 2026-10-05.

**Where this file is.** The plan recommends Project A as the base. This session
can push only to `claude/fervent-ptolemy-uz80na` in Project B, so the file is
here for review. After approval, step 0 moves it to Project A.

---

## 1. Audit

### 1.1 Summary table

| | Project A — State Tracker | Project B — Policy Radar |
|---|---|---|
| Purpose | State bills, state agency rules, local ordinances for the 8 regional teams | Federal rulemaking and Congress for the 5 policy divisions (HQ) |
| Framework | Next.js 16.3, React 19.3, TypeScript 5.9 | Next.js 16.3, React 19.0, TypeScript 5.7 |
| ORM | Prisma 6.19 | Prisma 6.1 |
| Database | PostgreSQL on **Neon** (pooled URL at run time, direct URL for migrations) | PostgreSQL on **Render** |
| Migrations | 17 (`0_init` … `16_result_withdrawn`) | 12 (`0_init` … `9a_triage`) |
| Size | ~11,000 lines. 25 pages, 40+ components | ~6,800 lines. One page component of 1,668 lines (`Dashboard.tsx`) |
| Login | One shared password (`APP_PASSWORD`, cookie `slt_gate`), `src/proxy.ts` | One shared password (`APP_PASSWORD`, cookie `pr_gate`), `src/middleware.ts` |
| Identity | "Acting as" picker (cookie `slt_actor`). Roles: DIRECTOR, ASSOCIATE, ADMIN, HQ, VIEWER. ADMIN guards `/admin/sources` | "Acting as" picker, on trust. No roles |
| App host | Vercel project `state-legislative-tracker` → `state-legislative-tracker.vercel.app` | Vercel project `apipolicydashboard` → `apipolicydashboard.vercel.app` |
| Custom domain | None | None |
| Scheduler | GitHub Actions `collect.yml`, hourly at :17, digest at 10:43 UTC weekdays, calls the app over HTTP | Render cron `collect-federal-register`, hourly at :00, calls the app over HTTP |
| Email | Resend (urgent alerts, daily digest) | None |
| Design | Barlow + IBM Plex Mono. api.org colours (navy, API blue, API red). Light and dark | Public Sans + Source Serif 4 + IBM Plex Mono. Blue accent `#1f5fae`. Light and dark |

Both apps use the same pattern: the scheduler never connects to the database; it
calls `POST /api/collect` with the header `x-collect-secret`. This makes the merge
of the jobs easy.

### 1.2 Data models

**Project B** (`prisma/schema.prisma`)

| Table | What it holds |
|---|---|
| `Division` | 5 rows: `up`, `mid`, `down`, `gas`, `corp` |
| `Person` | Staff. One division each. `isLead`, `isLitigationLead` |
| `Item` | One tracked thing. Unique `docket`. `track` = FEDERAL, CONGRESS, STATE, COURT. Priority, position, triage, owner, division, comment deadline, archive fields, Regulations.gov comment counts |
| `Watch` | What the collectors look for: AGENCY, TERM, DOCKET, EXCLUDE, JURISDICTION, BLOCK |
| `Finding` | One change a collector saw, with a JSON diff |
| `Audit` | Every human edit. Survives a deleted item (`itemId` set to null) |
| `AgentRun` | One row per collector run |

**Project A** (`prisma/schema.prisma`)

| Group | Tables |
|---|---|
| Places | `Region`, `State` (code is the key; no region = HQ), `Agency`, `LocalBody`, `LegislativeSession` |
| People | `Person` (role, region, email settings), `CommitteePref`, `RecordView` |
| What to look for | `Category` (the same 5 divisions), `Topic`, `Term`, `Exclusion`, `StateRule` |
| Records | `Record` (kind = BILL, RULE, BALLOT, ORDINANCE; unique `stateCode + session + identifier`), `Match`, `TextCheck`, `BillAction`, `Version`, `Hearing`, `HearingItem`, `Note`, `RelatedBill`, `CheckFlag` |
| History | `Audit`, `Event` (feeds the digest) |
| Runs | `Scanner`, `Run` |
| Learning | `Suggestion`, `IssueFeedback`, `IssueWeight`, `Setting`, `ReportSetting` |

### 1.3 Environment variables (names only)

| Name | A | B | Note |
|---|---|---|---|
| `DATABASE_URL` | yes | yes | Different databases (Render vs Neon) |
| `DIRECT_DATABASE_URL` | yes | — | Neon direct host for migrations |
| `APP_URL` | yes | job only | |
| `APP_PASSWORD` | yes (**not set in Vercel production**) | yes (set in Vercel) | See risk R1 |
| `COLLECT_SECRET` | yes | yes | Different values today |
| `OPENSTATES_API_KEY` | yes | yes | One free key allows ~10 requests a minute |
| `ANTHROPIC_API_KEY` | yes | yes | |
| `CLAUDE_MODEL`, `PAGE_MODEL`, `SUMMARY_MODEL`, `NOISE_BELOW` | yes | — | |
| `RESEND_API_KEY`, `ALERT_FROM` | yes | — | |
| `DATA_GOV_API_KEY` | — | yes | Congress.gov, Regulations.gov |
| `COURTLISTENER_TOKEN` | — | Vercel only | Not read by the code |
| `COLLECT_DAYS`, `CLASSIFY_AFTER_COLLECT`, `CLASSIFY_CAP` | — | Render job | |
| `STATES_ENABLED`, `STATES_HOUR`, `STATES_DAYS` | — | Render job | Drop after the merge: A owns states |
| `ROSTER_CSV` | — | yes | |
| `OPENSTATES_PAUSE_MS`, `BACKFILL_DAYS`, `LOCAL_BACKFILL_DAYS`, `MIN_POP` | yes | — | Scripts and collectors |

The Render workspace was not read (the Render connector asks which workspace to
use). The Render facts above come from `render.yaml` and the README.

### 1.4 Scheduled jobs

| Project | Job | When | What it calls |
|---|---|---|---|
| B | Render cron `collect-federal-register` (`scripts/trigger.mjs`) | Hourly, :00 UTC | `/api/collect?days=3` (Federal Register, Congress.gov, Regulations.gov), then `/api/admin/classify?limit=25`. State sweep is off (`STATES_ENABLED=0`) |
| A | GitHub Actions `collect.yml` (`scripts/trigger.mjs collect`) | Hourly, :17 | `/api/collect`: Open States bills, tracked bills, text checks, hearings (PA pages relayed from GitHub), PA Bulletin, MI MOAHR, local agendas, page reader, relevance score, urgent email |
| A | Same workflow, `digest` mode | 10:43 UTC weekdays | Daily digest email and Claude term proposals |

### 1.5 External APIs and AI calls

| | A | B |
|---|---|---|
| Federal Register | — | yes (no key) |
| Congress.gov, Regulations.gov | — | yes (`DATA_GOV_API_KEY`) |
| Open States | yes, main feed | yes, parked |
| State sites | palegis.us, PA Bulletin, MI MOAHR | — |
| Local sites | Legistar, Granicus iQM2, NovusAgenda, PrimeGov | — |
| Email | Resend | — |
| Claude | `src/lib/claude.ts`: relevance score, term proposals, AI summary (`CLAUDE_MODEL`, default `claude-opus-5-5`, with server-side fallback); page reader (`PAGE_MODEL`, default `claude-haiku-4-5`) | `src/lib/classify.ts`: files Unassigned items into a division. Model is **hard-coded** `claude-opus-5` |

### 1.6 Main pages and features

**Project B:** `/regulatory`, `/congress` (one dashboard per track), `/coverage`
(agencies, terms, dockets, exclusions with hit counts), `/login`. Features: the
48-hour comment band, "Position needed" count, priority / division / owner /
position edit with audit, inbox and "do not track", add a record from a Federal
Register number or URL, bulk edit, retention archive, Regulations.gov comment
counts, the division classifier, status endpoint.

**Project A:** see its README. Overview, three track pages (Legislation,
Regulation, Local) with To Decide and Tracked tabs, `/bills` table with Excel
export, bill page with versions and redline, Calendar with Outlook files,
My Committees, Reports, Topics and terms, Tags, Learning, Coverage, admin pages
for regions, people, sources and flags, email preview.

### 1.7 Shared concepts and where data overlaps

| Concept | A | B | Overlap |
|---|---|---|---|
| Issue area | `Category` (same 5 names) | `Division` (`up` … `corp`) | **Same list.** Map by name |
| Person | `Person` + region + role | `Person` + division | Same people can be in both. Match by email, then by name |
| Tracked thing | `Record` | `Item` | Same idea. Different keys and fields (table in 3.2) |
| Inbox / tracked | `Triage` INBOX, TRACKED, DISMISSED | `Triage` INBOX, TRACKED | B deletes on "do not track" and keeps a BLOCK watch. A keeps a DISMISSED record |
| Position | NONE, SUPPORT, OPPOSE, MONITOR, AMEND | PENDING, SUPPORT, OPPOSE, AMEND, MONITOR | Same, PENDING = NONE |
| Priority | HIGH, MEDIUM, LOW | URGENT, HIGH, MEDIUM, LOW, NOT_RELEVANT | **Different** (risk R4) |
| Search terms | `Term`, `Exclusion` | `Watch` TERM, EXCLUDE | Same idea, different targets (Federal Register vs state bills) |
| Agencies | `Agency` (state, sweep flag) | `Watch` AGENCY (federal) | Same idea |
| State bills | `Record` kind BILL | `Item` with `track = STATE` (parked, from Open States) | **Direct duplicates are possible** |
| States / jurisdictions | `State.enabled` | `Watch` JURISDICTION | Same idea |
| Sessions | `LegislativeSession`, `Record.session` | — | A only. Congress number is the federal equivalent |
| Change log | `Event` | `Finding` | Same idea |
| Human edits | `Audit` | `Audit` | Same shape |
| Runs | `Scanner` + `Run` | `AgentRun` | Same idea |

---

## 2. Base project: **Project A (State Legislative Tracker)**

Reasons:

1. **It has more of the parts the merged site needs.** Per-person roles and an
   ADMIN role, a people admin page, regions, email alerts and digest, a
   multi-page navigation with a setup menu, global filters (state, session,
   track) and a learning loop. Project B has none of these.
2. **It is larger.** About 11,000 lines against 6,800. To move B into A is less
   work than to move A into B.
3. **Its data model is a superset.** `Category` = `Division`. `Record` can hold a
   federal item with a few new columns. B's `Item` cannot hold A's versions,
   hearings, actions, sessions or local bodies without a large change.
4. **It follows the current Next.js 16 rules.** A uses `src/proxy.ts`. B uses
   `src/middleware.ts`, which Next.js 16 deprecates.
5. **Project B already gave the state work to A.** B's state track is parked and
   its schema says it follows the state tracker.

Why not B: B has the clearer federal features and a well-documented collector.
These move into A as a new section. The B code is not lost; it is ported.

---

## 3. Merge plan

### 3.1 How B's features move into A

New section **Federal** in A, with two new track tabs next to Legislation,
Regulation and Local:

| New track (A `TRACKS`) | Record kinds | Date shown | From B |
|---|---|---|---|
| **Federal rules** (`/federal`) | `FEDERAL_RULE` | Comments due | `/regulatory` |
| **Congress** (`/congress`) | `FEDERAL_BILL` | Last action | `/congress` |

Do not use the path `/regulatory`: it is too close to A's `/regulation` (state
rules). Old B paths redirect (section 3.6).

| B feature | Where it goes in A |
|---|---|
| Federal Register, Congress.gov, Regulations.gov sources and collectors | `src/lib/sources/` and new `src/lib/collect-federal.ts`. They write `Record`, `Event`, `Scanner`, `Run` |
| Keyword routing (`routing.ts`) | Sets `Record.categoryId` (Category = division) |
| Classifier (`classify.ts`) | Uses A's `src/lib/claude.ts` (one model setting, fallback). Remove the hard-coded model |
| 48-hour comment band | Top of the Federal rules track page and on the Overview. A's red-means-urgent rule already fits |
| "Position needed" count | Federal track badge (A's track badges already count items that need action) |
| Add by Federal Register number or URL (`/api/lookup`) | A's `/bills/new` page gets a "Federal" source option |
| Coverage page (agencies, terms, dockets, exclusions) | A's `/coverage` and `/topics`, with a Federal filter |
| Regulations.gov comment counts | Federal record page, new panel |
| Retention archive | New `archivedAt` column. Same rule as B: only records nobody touched |
| Bulk edit, refresh one item | A's record list and record page |
| Status endpoint (`/api/admin/status`) | Port as is. A has none |

Shared components: use A's `RecordRow`, `RecordEditor`, `DecisionButtons`,
`FilterBar`, `TagChip`, `Nav`, `TrackSwitch`. Do not port B's 1,668-line
`Dashboard.tsx` as one piece. Port its parts (band, chart) as small components.

### 3.2 Data migration

**Target database:** A's Neon database. B's Render database stays as a
read-only backup for 90 days.

**Method:**

1. Copy B's whole database into a separate schema `radar_legacy` in Neon with
   `pg_dump` / `pg_restore`. This is the no-data-loss guarantee: every B row
   stays readable in the same database, even rows that do not map.
2. A new script `scripts/import-radar.ts` reads `radar_legacy` and writes A's
   tables. Every new row gets `legacyId` (B's id). The script is
   **idempotent**: a second run updates, it does not duplicate. It has a
   `--dry-run` mode that prints counts only.
3. A reconciliation report compares counts and human fields before and after.

**New columns and values in A (all additive):**

- `RecordKind`: add `FEDERAL_RULE`, `FEDERAL_BILL`, `COURT`.
- `Priority`: add `URGENT` and `NOT_RELEVANT` (see R4), or map them. Decision needed.
- `Record`: `legacyId`, `unit`, `standards[]`, `draftState`, `priorityConfirmed`,
  `classifiedAt`, `archivedAt`, `archivedReason`, `publishedOn`, `source`,
  `commentCount`, `commentsCheckedAt`, `recentCommenters`.
- `Event`: `detail Json?`, `source`.
- `Person`: `categoryId?` (home division), `isLead`, `isLitigationLead`, `legacyId`.
- `Term` and `Exclusion`: `scope` = STATE | FEDERAL (default STATE), so B's
  federal terms never change state bill matching (R6).
- `State`: one new row `US` "United States (federal)", plus a column
  `level` = STATE | FEDERAL so that region and HQ logic can skip it (R2).

**Table mapping:**

| B | → A | Rules |
|---|---|---|
| `Division` | `Category` | Match by name. No new rows expected |
| `Person` | `Person` | Match by email, then by exact name. A match: add `categoryId` and lead flags; keep A's role and region. No match: new person, `regionId = null` (HQ), role `HQ` |
| `Item` (FEDERAL) | `Record` kind `FEDERAL_RULE` | `stateCode = US`, `identifier = docket`, `externalId = "fr:" + docket`, `session = null`, `body = agency`, `status = stage`, `summary = abstract`, `citation = frCitation`, `snapshot = lastSnapshot`, `lastCheckedAt = lastSeenAt`, `positionBy = positionSetBy`, `positionAt = positionSetAt`, `categoryId` from division, `ownerId` from person map |
| `Item` (CONGRESS) | `Record` kind `FEDERAL_BILL` | As above. `session` = Congress number (for example `119`) |
| `Item` (COURT) | `Record` kind `COURT` | As above. No page until a court feed exists (as in B today) |
| `Item` (STATE) | `Record` kind BILL | If A has the same bill (`stateCode + session + identifier`, or `openstatesId`): keep A's record; add B's human decisions **only where A has none**; copy B's audit rows to it. If A has no such bill: import only when a person decided something in B (TRACKED, a position, or a set priority). Other rows stay in `radar_legacy` only. Decision needed |
| `Item.position` PENDING | `Position.NONE` | Others 1:1 |
| `Item.triage` | `Triage` | 1:1 |
| `Watch` BLOCK | `Record` with `triage = DISMISSED` | A's rule: a dismissed record is kept so it is not flagged again. Reason "Do not track (from Policy Radar)" |
| `Watch` AGENCY | `Agency` with `stateCode = US` | `sweep = true` |
| `Watch` TERM | `Term` with `scope = FEDERAL` | Under a topic "Federal (imported)". Keep hit counts |
| `Watch` EXCLUDE | `Exclusion` with `scope = FEDERAL` | `status = ACTIVE` or `PAUSED` from `active` |
| `Watch` DOCKET | `Record` (TRACKED) or new `Term` kind DOCKET | Decision in step 6 |
| `Watch` JURISDICTION | `State.enabled` | Report only. **Do not change A's monitored states** without the regions |
| `Finding` | `Event` | `kind = "FINDING"`, `summary`, `detail`, `at = foundAt`, `emailedAt = foundAt` (so old findings are never emailed) |
| `Audit` | `Audit` | 1:1. Rows with `itemId = null` keep `recordId = null` |
| `AgentRun` | `Run` + `Scanner` | Scanner ids `federal-register`, `congress-gov`, `regulations-gov`, `openstates:radar` |

**Duplicates and conflicts:**

- People: one list of matches goes to a person for review before the real run.
  B has unique `(name, division)`, so one name can be in two divisions. In A the
  unique key is `(name, regionId)` and Postgres lets two nulls through, so the
  script must de-duplicate itself.
- Records: `externalId` and `legacyId` are unique, so a re-run cannot duplicate.
- Audit `actor` is a name as text. Keep the text as is; do not rewrite history.

### 3.3 One login

Phase 1 (with the merge):

- One door: A's `src/proxy.ts`, one `APP_PASSWORD`, cookie `slt_gate`.
- B's users enter the shared password once on the new site (B's `pr_gate`
  cookie does not carry over; the domains are different).
- One "Acting as" list: the merged `Person` table. B's people appear under HQ,
  with their division.
- Roles for B's people: `HQ` by default. Division leads can be `ADMIN` if they
  must edit sources. Decision needed.
- Set `APP_PASSWORD` in A's Vercel **production** before any federal data moves
  in (R1).

Phase 2 (both roadmaps already ask for it, needs approval): real sign-in with
Microsoft Entra ID. Map the signed-in email to `Person.email`. Every change
already stores a person name, so no data change is necessary.

### 3.4 Navigation, master filters and design

**Navigation (A's `Nav.tsx` and `TrackSwitch.tsx`):**

- Top bar: Overview, Calendar, My Committees, Reports, Setup menu (no change).
- Track tabs: Legislation · Regulation · Local · **Federal rules** · **Congress**,
  each with a count badge. "All tracks" clears the choice.
- Setup menu: add "Federal sources" (agencies, dockets) inside `/admin/sources`,
  and "System status".

**Master filters (one setting for the whole app, kept per browser):**

| Filter | Change |
|---|---|
| Place (`PlacePicker`) | Add **Federal** above the regions. "All States" stays state-only; a new "Everything" shows state + federal. Federal tracks ignore the place filter |
| Session (`SessionPicker`) | Federal rules: no session. Congress: current Congress / last Congress |
| Track (`TrackSwitch`) | 5 tracks |
| Issue (`Category`) | Already in A. It is B's division filter |
| Owner, position, priority | Already in A's `FilterBar` |

**Design:** use A's design system (api.org colours, Barlow, red = urgent only).
The two systems already share track colours (`#2a78d6`, `#1baf7a`). Add colours
for the two federal tracks, checked as one categorical set for colour blindness
(A already does this check), each with a text label. Port B's 48-hour band and
deadline chart in A's tokens. One site name and logo: decision needed (for
example "Policy Radar" for all of it, or "API Policy Tracker").

### 3.5 Scheduled jobs in one project

- One endpoint: A's `POST /api/collect`, with `?source=` for each part, as B
  already does (`federal`, `congress`, `regulations`, `classify`).
- One scheduler: A's GitHub Actions workflow. The hourly step makes separate
  HTTP calls (state, then federal, then classify), so one slow source does not
  use the time of the others, and each call stays inside the Vercel time limit.
- The digest step adds federal changes for HQ people and division owners only.
- One Open States consumer: A. B's parked Open States collector is not ported.
  This also stops two apps from sharing one rate limit.
- Render cron: A's roadmap asks for a second hourly trigger, because GitHub
  skips scheduled runs when busy. Option: keep the Render cron, point it at the
  merged app, and add the "skip if the last run was less than 30 minutes ago"
  guard. Otherwise delete it after cutover. Decision needed.
- One `COLLECT_SECRET` (A's). Rotate it at cutover.

### 3.6 Hosting

- One Vercel project: `state-legislative-tracker` (rename it to the new site
  name; the `.vercel.app` address can get a new alias).
- One database: Neon.
- One domain: `state-legislative-tracker.vercel.app` today. A custom domain is
  recommended for a merged product. Decision needed.
- Old URL: keep the Vercel project `apipolicydashboard`, but deploy a
  redirect-only version (a `vercel.json` with permanent redirects):

  | Old | New |
  |---|---|
  | `/` and `/regulatory` | `/federal` |
  | `/regulatory?item=<id>` | `/bills/<new id>` (lookup by `legacyId`) |
  | `/congress` | `/congress` |
  | `/coverage` | `/coverage?track=federal` |
  | `/login` | `/login` |
  | `/api/*` | no redirect: return 410 with the new address, so a stale caller fails loudly |

- After 30 days with no traffic on the old project, archive repository B.

### 3.7 Risks and what can break

| # | Risk | What can break | Control |
|---|---|---|---|
| R1 | A's production has **no `APP_PASSWORD`** in Vercel | Federal positions and notes are open to anyone with the link | Set it first (step 0). Test: a private window goes to `/login` |
| R2 | A's code expects every record to have a real state | Region filters, HQ ("no region"), digests by region, counts would show federal items in the wrong place or hide them | `State.level`; step 2 changes `scope()` and counts first, with tests, before any federal row exists |
| R3 | `@@unique([stateCode, session, identifier])` lets duplicates through when `session` is null | A federal rule imported twice | Use `externalId` and `legacyId` (unique) as the import key |
| R4 | Priority sets differ | URGENT and NOT_RELEVANT are lost if mapped to HIGH and LOW | Add the two values (additive). Or map them and keep the old value in `Audit`. Decision needed |
| R5 | "Do not track" differs | B deletes the item; A keeps it as DISMISSED | Use A's rule. Import B's BLOCK rows as DISMISSED records |
| R6 | A federal term could flood the state Inboxes | B's terms search the Federal Register; A's terms match state bills | `Term.scope`. Test: the state matcher term count does not change |
| R7 | On an **empty** database, `10_…` to `16_…` can sort before `1_ai_summary`. B's own README records this failure. A's live database is not affected; a fresh test database can be | Migration names sort as text | Name the new migration `9a_federal` (sorts last). Test: replay all migrations on an empty Neon branch |
| R8 | Writes in B after the copy are lost | Two databases during the move | Freeze B (read-only page) before the final import |
| R9 | Federal + state + classify in one call can time out | Vercel function time | Separate HTTP calls (3.5) |
| R10 | B's classifier plus A's relevance and summaries | Claude cost | One model setting in `claude.ts`; keep B's caps (`CLASSIFY_CAP`) |
| R11 | Copying B's `middleware.ts` style code into A | Next.js 16 rules | Port to `proxy.ts`; read `node_modules/next/dist/docs/` first, as AGENTS.md says |
| R12 | Two rows for one person, or one person shown in the wrong division | Person merge | Review list before the real import |
| R13 | 404s | Bookmarks and old API callers | Redirect table (3.6), 410 on old API paths |
| R14 | Federal data written to the old database | Old Render cron still calls B after cutover | Disable it or repoint it in the cutover step |

### 3.8 Steps in order (one PR each)

All PRs go to Project A unless noted. Every step is additive and can ship alone.

| Step | PR | Change | Test |
|---|---|---|---|
| 0 | — (ops) | Set `APP_PASSWORD` on A production. Make a Neon branch and a Render backup. Move this plan into A. Record start counts for every table in both databases | Private window gets `/login`. Count file is saved |
| 1 | Schema | Migration `9a_federal`: new enum values, new columns, `US` state row, `State.level`, `Term.scope`, `Exclusion.scope` | `prisma migrate deploy` on a copy branch of production. Replay on an empty branch. `npm run typecheck`, `npm run build`. Every existing page loads with the same counts |
| 2 | Scope | `scope()`, counts, digests and region filters skip `level = FEDERAL` unless the place is Federal or Everything | Insert one test federal record on a branch: state counts, Overview and digest preview do not change; Federal shows 1 |
| 3 | Sources | Port Federal Register, Congress.gov and Regulations.gov sources and collectors. Off until `FEDERAL_ENABLED=1`. Port `smoke.ts` | `npm run smoke -- 14` with no database. On a branch: one run creates records; a second run creates 0 |
| 4 | Classifier | Port `routing.ts` and `classify.ts` onto `claude.ts` | On a branch, `limit=5`: only uncategorized federal records change; reasoning is written to `Event` |
| 5 | UI | Federal rules and Congress tracks, 48-hour band, Position needed badge, add by FR number, federal panel on the record page | Typecheck, build, screenshot each track at desktop and phone width (Playwright), light and dark |
| 6 | Coverage | Federal agencies, terms, dockets and exclusions on `/coverage`, `/topics`, `/admin/sources` | State term list and state Inbox counts do not change |
| 7 | Import script | `scripts/import-radar.ts` with `--dry-run`, people review list, reconciliation report | Dry run on a branch, then a real run on the branch, then a second run: 0 new rows. Report: every B item is mapped or listed as skipped with a reason; positions, priorities, owners and audit counts match |
| 8 | Scheduler | Workflow calls the federal sources and the classifier. Optional Render backup trigger with the 30-minute guard | `workflow_dispatch` run is green; one `Run` row per scanner |
| 9 | Alerts | Federal changes in the HQ digest; federal comment deadlines in the urgent email and the Calendar `.ics` | `/alerts` preview shows the federal section only for HQ people |
| 10 | Design | Site name, federal track colours, B's chart in A tokens | Colour check script, screenshots |
| 11 | — (cutover) | Freeze B. Copy B into `radar_legacy`. Run the import on production. Set `FEDERAL_ENABLED=1`. Rotate `COLLECT_SECRET`. Disable B's Render cron | Reconciliation report on production equals the branch report. One full hourly run is green |
| 12 | B repo | Replace B with redirect-only `vercel.json` | `curl -I` on each old path gives 308 to the right new path; `/api/collect` gives 410 |
| 13 | — (clean up, +30 days) | Archive repo B. Delete the Render cron. Keep the Render database backup 90 days | No traffic on the old project in Vercel analytics |

### 3.9 Rollback plan

| Step | How to go back |
|---|---|
| Any code PR | Vercel "Instant Rollback" to the last good deployment, then revert the PR. All schema changes are additive, so old code still runs on the new schema |
| 1 (schema) | Do not drop columns in a hurry. Old code ignores them. If necessary, a down migration drops only the new columns and enum values (only before step 11) |
| 3–9 | Set `FEDERAL_ENABLED=0`. Nothing federal is collected or shown |
| 7 / 11 (import) | `DELETE FROM "Record" WHERE "legacyId" IS NOT NULL` (cascades to events, notes, matches), and the same for imported people and terms. Or restore the Neon branch made in step 0 (point-in-time restore) |
| 11 (cutover) | B stays deployable for 30 days: remove the freeze, re-enable the Render cron. Writes made in the merged app during the failed window are listed by the reconciliation script for manual re-entry |
| 12 (redirects) | Redeploy B's previous deployment in Vercel |

---

## 4. Decisions needed before step 1

1. Site name and logo for the merged product.
2. Priority: add URGENT and NOT_RELEVANT to A, or map them?
3. B's state bills that A does not have: import only those with a human decision (recommended), or all?
4. Role for B's people: HQ for everyone, ADMIN for division leads?
5. Keep the Render cron as a second trigger, or use GitHub Actions only?
6. Custom domain: yes or no?
7. Approve this plan. **No code changes until approval.**
