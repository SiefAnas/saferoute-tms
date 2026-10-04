# Company timezone report

Date: 2026-10-04. Branch `company-timezone`, from `main` (`d33f078`), worktree
`C:\Users\anas2\saferoute-timezone`. **Not merged, not pushed**, no upstream. Only local embedded
Postgres was used: this branch has its own dev DB on port 5488 (the shared 5499 one holds
`account-settings`' 030/031). First check: `localhost:5488`, server reports `::1 saferoute_dev`.
No Neon, no Render.

Survey: `docs/TIMEZONE_SURVEY.md`. Progress log: `docs/TIMEZONE_PROGRESS.md`. Open questions:
`docs/TIMEZONE_QUESTIONS.md`.

| # | Task | Commit(s) |
|---|---|---|
| 1 | Survey, no code | `ffdbc45` |
| 2 | Column, helpers, middleware | `22bf0d6` |
| 3 | Convert business-date code, one service per commit | `48c73c7` shared + schedule + monitors, `70666cb` sessions, `9d597d0` parent portal, `75bcdd6` payroll, `8bb8532` dashboard, `919d14f` school side, `029abae` assignment overlap, `819a80c` docs |
| 4 | Edge-case tests | `b9993ea` |
| 5 | Setting in the UI | `a0ac5e5` |
| 6 | Can the DB-level setting go? (this report) | — |

---

## The answer you asked for: does any business decision still depend on the database session timezone?

**No, not in the API (`server/src`).** After task 3:
- No `CURRENT_DATE`, `CURRENT_TIME`, `LOCALTIME`, `date_trunc`, `generate_series`, `::date` on a
  `timestamptz`, `date + time → timestamptz`, or date string compared with a timestamp is left in
  `server/src` (swept; only comments mention them).
- Company users: every "today" is `req.businessDate`, computed once per request in the company's
  zone with Intl and passed into SQL as a `$n::date`. "On that day" for timestamps is an instant
  range `[local midnight, next local midnight)` computed in JS. The skip cutoff compares the
  company's wall clock in JS.
- School users (no single zone, see C1 below): each row is compared with its own company's date,
  `($now::timestamptz AT TIME ZONE c.timezone)::date`. That's an explicit conversion with a bound
  instant and the company's zone, so it doesn't read the session setting either.
- **Proved by a test**, not just by reading: suite 42 sets `ALTER DATABASE … SET timezone` to UTC,
  Pacific/Kiritimati (UTC+14) and Pacific/Pago_Pago (UTC−11), re-runs the same scenario in a fresh
  process each time (schedule, skip eligibility, payroll, absent-today; 56 answers) and requires
  identical results. A control query (`'2026-10-15T05:30Z'::date`) does change across those three
  (15th, 15th, 14th), which shows the setting really applied.

**What still reads the session zone** (none of it is an API business decision):
1. `server/scripts/seed-dummy-data.js:202`: dev seed sets an override for `CURRENT_DATE`. Dev only.
2. `schedule_changes.change_date DEFAULT CURRENT_DATE` (migration 018). The app now always passes the
   date; the default is only used by hand-written SQL.
3. Interval arithmetic on instants, e.g. temp-password expiry `now() + interval '7 days'`: across a
   DST change "7 days" in the session zone can be ±1 hour. Expiry windows, bucket (b), harmless.
4. **On the unmerged `account-settings` branch** (new code there, not on main):
   `scripts/snapshot-usage.js` uses `CURRENT_DATE` for `captured_on`, and the closure sets
   `closure_purge_at = now() + interval '30 days'` (±1 hour across DST). When that branch is merged
   with this one, the snapshot date should become each company's business date (or UTC, a
   decision). The 30 days are fine either way.
5. Hand-written queries in the Neon console display `timestamptz` in the session zone. Display only.

A separate, **process-level** dependency (not the DB): node-postgres turns `DATE` columns into JS
`Date` objects at the Node process's local midnight, which is why API dates look like
`"2026-09-22T00:00:00.000Z"` on Render (process in UTC). Business decisions here don't use those
objects any more (the one place that did, assignment overlap, is fixed in `029abae`). Left as is;
it would be a separate change (a pg type parser that returns `DATE` as plain text).

---

## What I built

### Task 1: survey
`docs/TIMEZONE_SURVEY.md`: every call site by file and line, bucketed. Bucket (c) had 3 entries, so
no stop. During task 3 I found 3 more (a) sites that reach `CURRENT_DATE` through the shared helper
(`schools.js`, `users.js` deactivation check, `driverScope`); added to the survey.

### Task 2: column and plumbing
- **Migration 032** `companies.timezone text not null default 'America/New_York'` (backfill = the
  default, which is what every company effectively ran in). Up/down/up tested.
- **`server/src/time/clock.js`**: the server's "now" for business decisions, pinnable in tests
  (`_pin`, refuses outside `NODE_ENV=test`).
- **`server/src/time/businessDate.js`** (Intl only, **no date library**):
  `businessDateFor(companyOrId, now?)` → `'YYYY-MM-DD'`, `businessNowFor(companyOrId, now?)` →
  `{ timeZone, instant, date, time, minutesOfDay }`, plus `dateInZone`, `nowInZone`,
  `startOfDay(date, zone)` (local midnight instant; handles 23/25-hour days and zones where DST
  skips midnight), `dayRange`, `addDays` (pure calendar maths), `isValidTimeZone`,
  `isKnownToDatabase`. Every function takes an optional `now`.
- **`server/src/middleware/businessDate.js`**, called once at the end of `authenticate` (which
  already loaded the company, so no extra query): sets `req.now`, `req.businessNow`,
  `req.businessDate`. Services read those; none looks the zone up again. School users get `null`
  and use per-row company zones.
- **Validation on write:** `PATCH /companies/me { timezone }` accepts a well-formed IANA name that
  both Intl and `pg_timezone_names` know (Node's own list has `Asia/Calcutta` but not `Asia/Kolkata`
  and no `UTC`, so it isn't used as the gate). `400` otherwise.
- `GET /auth/me` now also returns `companyTimeZone`.

### Task 3: conversions (one commit per service)
Schedule (today, week, no-show date, today's assignment for trips / no-shows), driver read scope
(students, vans, schools, assignments), monitor home, session check-in rule, parent portal (skip
cutoff, skip dates, detail, today's trips), payroll, dashboard, school-side schedule changes and
student list, van delete message, deactivation check. Details per commit in the progress file.

**Payroll, read carefully** (`75bcdd6`):
- A period `from`/`to` given as dates (driver "this month", dashboard) now runs from local midnight
  of `from` to local midnight of `to` **in the company's zone** (before: midnight in the session
  zone, because Postgres read `check_in_at >= '2026-10-01'` that way).
- A session's work day (daily rate, days worked, shift completeness) is its check-in date in the
  company's zone (before: `check_in_at::date`, session zone).
- When `from` is an instant (`paid_through_at`, the unpaid cycle), sessions compare exactly as
  before; adjustments (which only have a `work_date`) use that instant's date **in the company's
  zone** (before: the date in the Node process's zone). See C2.
- Bad `from` / `to` now answer `400` instead of a database error.

Also fixed on the way (`029abae`): assignment overlap checks parsed request dates as UTC midnight but
stored dates at local midnight, so in a process west of UTC an assignment ending the day before
another started was refused as overlapping. Shown with `TZ=America/Los_Angeles` before / after.

### Task 4: tests that prove it
`server/test/42-timezone-edges.test.cjs`, 49 checks through the HTTP API, clock pinned:
- **Two zones, one instant:** 2026-10-15T05:30Z → NY on Oct 15, LA on Oct 14.
- **11:30pm local:** NY 23:30 → still Oct 14; LA 23:30 (06:30Z, already Oct 15 in NY and UTC) →
  Oct 14.
- **Skip cutoff** (pickup 07:45): NY eligible at 07:14 EDT, too late at 07:15; LA still eligible at
  that same instant (04:15 PDT), too late at 07:15 PDT.
- **Payroll boundary:** a shift at 2026-10-01T05:30Z counts on Oct 1 for NY and Sep 30 for LA.
- **DST spring forward (Mar 8) and fall back (Nov 1), both zones:** 23-hour and 25-hour days, both
  01:30s on fall-back day, skip cutoff at 07:15 *local* on both days (not an hour off), 11:30pm on
  both days still "today".
- **Absent today:** company admins by their own date; the shared school sees each row by its
  company's date.
- **Writes:** a skip at the same instant is refused for LA (its day's pickup has passed) and
  accepted for NY, dated Oct 16 (NY's date).
- **DB session timezone:** the three-zone comparison described above.
- **It can fail:** the same file run against `22bf0d6` (column and helpers in place, services still
  on `CURRENT_DATE`) fails 30 checks, including the payroll ones (pure timezone arithmetic, no clock)
  and the session-timezone comparison.

Plus `41-business-date-helpers` (49 unit checks, also re-run under process TZ UTC / Tokyo /
Honolulu) and `43-company-timezone-endpoint` (23).

### Task 5: the setting
- `/company/profile`, company_admin only: a **Time zone** card under the profile form, with a
  type-to-search list of IANA zones (each with its current UTC offset and local time; not a free
  text field), and plain text on what it controls: which day is "today", when a skip cutoff passes,
  which day payroll counts a shift in.
- Its own Save; saving opens a confirmation that says existing records get grouped by day
  differently (late-evening shifts can move day, pay periods and day totals for past dates can
  change, nothing is deleted).
- Endpoint tests in suite 43 (invalid zones refused with 400 and nothing stored, 403 for other
  roles, the next request already uses the new zone). Checked live: searched "los ang", saved,
  confirmed, stored `America/Los_Angeles`.

---

## Task 6: can the database-level `America/New_York` setting be removed?

**Short answer:** after this branch is deployed and checked, yes, safely, because nothing in the
API depends on it any more (suite 42 proves it for UTC, +14 and −11). **Not before**: on today's
`main` every "today" is the session zone's `CURRENT_DATE`, so removing it now would move the whole
server's day back to UTC (the day flips around 8pm in Boston, as `OVERNIGHT_REPORT_2.md` found).
**Recommendation: don't touch it during the pilot.** It costs nothing to keep, and it still covers
hand-written SQL, the dev seed and the `account-settings` snapshot script. Remove it after the
pilot, once the follow-ups below are done.

**What would break if it were removed after this branch is live:** nothing in the API.
Specifically:
- Daily usage snapshots (`account-settings` branch, if merged unchanged) would be dated in UTC: a
  run after 8pm Boston time is stamped with tomorrow's date.
- Anyone running SQL by hand in the Neon console sees timestamps in UTC instead of Boston time.
- The `schedule_changes.change_date` default would be the UTC date, but only for SQL that leaves it
  out; the app always sets it.
- Interval arithmetic (`now() + interval '7 days'` etc.) changes by up to an hour across a DST
  change. Irrelevant for expiry windows.

**What the removal involves** (for whoever does it, on Neon, not from this branch):
1. Find where it's set: `SELECT setdatabase::regdatabase, setrole::regrole, setconfig FROM
   pg_db_role_setting;` (it may be on the database or on the role), and `SHOW timezone;`.
2. `ALTER DATABASE <db> RESET timezone;` (or `ALTER ROLE <role> … RESET timezone`). The server
   default on Neon is GMT/UTC.
3. Restart the Render API service so the pool's existing connections pick up the new default (a
   setting changes new sessions only).
4. Check: `SHOW timezone;` from a new connection; the driver / parent / dashboard "today" in the
   app at a time when UTC and Boston are on different dates (between 8pm and midnight Boston).
5. Rollback: `ALTER DATABASE <db> SET timezone = 'America/New_York';` and restart again.

**Before removing it, do:** convert `snapshot-usage.js` to company business dates when merging
`account-settings`; decide C2; optionally drop the `change_date` default.

---

## Decisions and open questions (details in `docs/TIMEZONE_QUESTIONS.md`)
1. **C1: school users' "today"** is per row, by the owning company's zone (no `schools.timezone`).
2. **C2: an adjustment dated the day a cycle was marked paid** still counts as owed (unchanged
   result), now judged in the company's zone. The web client's `payrollCycle.ts` comment says the
   opposite was intended. Confirm.
3. **C3: the clients pick "this week" / "this month"** from the viewer's device clock. Near
   midnight / month end a viewer in another zone asks for a different period. Not changed here.
4. **Migration order:** if this branch is deployed before `account-settings` and
   `prod-safety-and-import-fix`, Neon will have run 032 before 030/031 exist, and node-pg-migrate
   then refuses to run them ("Not run migration … is preceding already run migration …", checked in
   its `runner.js`) unless run once with `--no-check-order`. Simplest: merge 030/031 first.
5. **Merge conflicts:** `prod-safety-and-import-fix` merges cleanly. `account-settings` conflicts
   in 4 files, all additive: `authenticate.js` (its closing check vs. this branch's
   `company_timezone` column + `attachBusinessDate`), `routes/companies.js` (its usage / billing /
   closure routes vs. the timezone validation), `CompanyProfilePage.tsx` (its danger zone vs. the
   time zone card; both go below the form), `01-schema` migration count (becomes 33 with all three).
   Checked with `git merge-tree`, nothing merged.

## What I did not do
- The mobile apps: they get the new behaviour through the API (they don't compute business dates)
  but have no timezone setting screen. The web client still formats past timestamps in the
  viewer's own zone, as intended.
- The pg `DATE` parsing change (process-level, see above).
- Remove the Neon setting (by instruction).

## Surprises
1. **Local Postgres hid the problem too.** The embedded Postgres inherits the OS zone (New York), the
   same as Neon's hand-set default, so no local run would have shown a UTC or LA day.
2. **`generate_series(date, date, interval)`** in the week view runs on timestamps in the session
   zone, so even "pure dates" depended on it. Replaced by `addDays` + `unnest($::date[])`.
3. **Node's Intl zone list** has `Asia/Calcutta` but not `Asia/Kolkata`, and no `UTC`, so it can't
   be the validation list on its own.
4. **Test ports are shared by every worktree**, and orphaned embedded-Postgres processes (parent gone,
   worker still holding the port or shared memory) make unrelated suites fail with "could not create
   any TCP/IP sockets" or "shared memory block is still in use". I only ever stopped orphans from
   this session's own worktrees.

## Test results
- **Full `npm test` (server): all 33 suites pass in a single run**, including the new
  `41-business-date-helpers` (49), `42-timezone-edges` (49) and `43-company-timezone-endpoint` (23),
  and `01-schema` with 30 migrations.
- An earlier full run had one failure: `25-tenant-isolation` stopped right after its first section
  header with no assertion and no error message. It passed when run on its own, and the second full
  run passed completely. I couldn't find the cause in the log. My repeat runs of that suite also
  hit the known leftover-embedded-Postgres problem ("shared memory block is still in use"), made
  worse by me cutting a run short with `head`. Not related to these changes, but noted.
- Client: `tsc -b` clean, `oxlint` no new warnings, `npm test` passes.
- Live check on the local stack (API 4310, Vite 5177, DB 5488 seeded): the time zone card, search,
  the confirmation dialog, and the saved value in the database.
