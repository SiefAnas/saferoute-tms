# Account settings: progress

Branch `account-settings`, made from `main` (`d33f078`) in its own worktree
(`C:\Users\anas2\saferoute-account`). Upstream is unset on purpose: nothing gets pushed by
accident. Not merged, not pushed. Local DB only (embedded Postgres, never Neon / Render).

Open questions: `docs/ACCOUNT_SETTINGS_QUESTIONS.md`. Final write-up:
`docs/ACCOUNT_SETTINGS_REPORT.md` (written at the end).

## How to resume
- Local dev DB: embedded Postgres on port 5499, data in the session scratchpad. Start it with
  the helper described in the last "Local DB" note below, then
  `DATABASE_URL=postgres://saferoute:saferoute@localhost:5499/saferoute_dev npm run migrate:up`
  from `server/`. There is no `server/.env` in this worktree on purpose (the main clone's points
  at production Neon).
- Server tests: `cd server && node test/<suite>.test.cjs` (each suite starts its own embedded
  Postgres). Client: `cd client && npx tsc -b && npm test`.

## Tasks

| # | Task | Status | Commit |
|---|---|---|---|
| 1 | Migration 030 | done | see log |
| 2 | Own account API | todo | |
| 3 | My account page | todo | |
| 4 | Usage + billing (read only) | todo | |
| 5 | Legal pages + acceptance | todo | |
| 6 | Closure, request side only | todo | |
| - | Final report | todo | |

## Log
- **Task 1 done.** `server/migrations/1752624000030_account-settings.js`. Tested on the local
  dev DB (embedded Postgres, port 5499): up, defaults (`pilot` / `free`), unique
  (company, day) snapshot, status CHECK, closure-dates CHECK, down (everything gone), up again.
  Suite 01's hard-coded migration count bumped 29 -> 30 (passes 20/20).
- Local DB note: the helper is `devdb.cjs` in the session scratchpad (embedded Postgres,
  persistent data dir). If that's gone, any embedded Postgres on 5499 with db `saferoute_dev`,
  user/password `saferoute` works.
