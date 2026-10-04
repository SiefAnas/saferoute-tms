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
| 1 | Survey (no code) | done | see log |
| 2 | Column + helpers + middleware | todo | |
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
