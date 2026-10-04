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
| 2 | Column + helpers + middleware | done | see log |
| 3 | Convert business-date code paths | todo | |
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
