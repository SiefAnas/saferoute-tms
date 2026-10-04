# Company timezone: progress

Branch `company-timezone`, from `main` (`d33f078`), worktree `C:\Users\anas2\saferoute-timezone`.
No upstream; not merged, not pushed. Local database only.

## How to resume
- Local DB for this branch: embedded Postgres on **port 5488** (its own data dir,
  `devdb-tz-data` in the session scratchpad, started by `devdb-tz.cjs` there). Not the shared
  5499 one: that holds `account-settings`' 030/031 migrations, which this branch doesn't have.
  `server/.env` (gitignored) points at `localhost:5488`. Check first:
  `node -e "require('dotenv').config(); console.log(new URL(process.env.DATABASE_URL).host)"` in `server/`.
- Migrations on this branch start at **032** (030 / 031 are taken by unmerged branches).
- Tests: `cd server && node test/<suite>.test.cjs`. New suites use ports 5486 / 5487 (Postgres) and
  5986 / 5989 (API). Avoid 4200 (suite 02) and the other test ports for live checks.

## Tasks

| # | Task | Status | Commit |
|---|---|---|---|
| 1 | Survey (no code) | done | `ffdbc45` |
| 2 | Column + helpers + middleware | done | `22bf0d6` |
| 3 | Convert business-date code paths | done | `48c73c7` … `029abae` |
| 4 | Edge-case tests | todo | |
| 5 | Timezone setting in the UI | todo | |
| 6 | Can the DB-level setting go? (report only) | todo | |
| - | Report | todo | |

## Log
- First check: `server/.env` → `localhost:5488`, server reports `::1 saferoute_dev`; session
  `TimeZone` there is `America/New_York` (inherited from the OS), the same as Neon's hand-set
  database default, so a local run would never have shown the problem either.
- **Task 1 done.** `docs/TIMEZONE_SURVEY.md`. Bucket (c) has 3 entries (C1 school-side "today",
  C2 same-day adjustment vs paid_through_at, C3 client-chosen week / month), so no stop.
- **Task 2 done.** Migration `1752624000032_company-timezone.js` (`companies.timezone text not null
  default 'America/New_York'`), tested up / down / up on 5488. `server/src/time/clock.js` (the
  server's "now", pinnable in tests via `_pin`), `server/src/time/businessDate.js` (`dateInZone`,
  `nowInZone`, `businessDateFor(companyOrId, now)`, `businessNowFor(companyOrId, now)`,
  `startOfDay(date, zone)` for payroll boundaries, `addDays`, `isValidTimeZone`,
  `isKnownToDatabase`). Intl only, no library. `middleware/businessDate.js` sets `req.now`,
  `req.businessNow`, `req.businessDate` once, called at the end of `authenticate` (which now also
  selects `companies.timezone` in the query it already ran). `PATCH /companies/me` accepts
  `timezone`, validated against Intl + `pg_timezone_names`. New suite 41 (49 checks, also re-run
  under process TZ UTC / Tokyo / Honolulu). Suite 01 count 29 -> 30; 01, 02, 15 pass.
- **Task 3 done**, one commit per service:
  - `48c73c7` shared: `assignmentNotEndedSql(alias, day)` now requires the day (throws without it);
    scoped accessor `notEnded` carries the business date; driver scope, driver school lookup,
    deactivation check, van delete message, `/schedule/today` + `/week` (week days by `addDays`,
    `unnest($::date[])`, not `generate_series` on timestamps), no-show date, today's assignment,
    monitor home (today's van; today's sessions as an instant range via `dayRange`).
  - `70666cb` sessions: "already worked this shift today".
  - `9d597d0` parent portal: skip cutoff on the company's wall clock in JS; skip dates; detail.
  - `75bcdd6` payroll: period bounds at local midnight (`startOfDay`), work day = check-in date in
    the company zone (JS), adjustment cutoff date in the company zone (C2), 400 on bad from/to.
  - `8bb8532` dashboard: company uses its date; school uses each row's company date (C1).
  - `919d14f` school side: schedule changes (date = student's company date via
    `businessDateFor(id)`), cancel today's pickup, school student list transport.
  - `029abae` assignment overlap: plain YYYY-MM-DD compare (old code: false overlap west of UTC,
    shown with TZ=America/Los_Angeles).
  - Sweep of `server/src`: no `CURRENT_DATE`, `CURRENT_TIME`, `LOCALTIME`, `date_trunc`,
    `generate_series`, or `::date` on a timestamp left. The only SQL date conversions are explicit
    `($n::timestamptz AT TIME ZONE c.timezone)::date` (school side), which don't read the session zone.
  - Suites run after each step: 04, 05, 09, 10, 11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 30,
    31 all pass. Orphaned test Postgres processes (dead parent) are stopped with
    `clean-orphans.ps1` in the scratchpad when "shared memory block" or port errors appear.
