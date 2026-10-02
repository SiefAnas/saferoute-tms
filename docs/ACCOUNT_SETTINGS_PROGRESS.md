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
| 1 | Migration 030 | done | `0cf5280` |
| 2 | Own account API | done | `0e6ab8a` |
| 3 | My account page | done | `c3f9aae` |
| 4 | Usage + billing (read only) | done | see log |
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
- **Task 2 done.** `server/src/services/account.js`; routes in `routes/users.js` (`/me…`, declared
  before `/:id`) and `routes/auth.js` (`/confirm-email-change`). `passwordChangedNow` now exported
  from `services/passwords.js`. New suite `test/32-own-account.test.cjs` (ports 5490 / 5991):
  70 passed. Suites 02, 09, 20 still pass. API_CONTRACT.md "Own account" section added.
- **Warning for whoever resumes: do NOT use the Browser pane's `preview_start` "api" config.** It
  runs from the original clone `C:\Users\anas2\saferoute-tms`, whose `server/.env` is production
  Neon. It happened once (2026-10-02, Task 3 check): the process answered `GET /health` and one
  failed `POST /auth/login` for `admin@company1.com` (a SELECT; a failed login writes nothing), then
  I stopped it. No migration, no write. Instead start the servers from this worktree by hand:
  `cd server && DATABASE_URL=postgres://saferoute:saferoute@localhost:5499/saferoute_dev node src/index.js`
  and `cd client && npx vite`, then open http://localhost:5173. This worktree's `server/.env`
  (gitignored) also points at the local DB only. Local DB seeded with `scripts/seed-dummy-data.js`
  (logins like `driver1@company1.com` / `admin@company1.com`, password `Secret123!`).
- **Task 3 done.** `client/src/pages/account/AccountPage.tsx` (Profile via ProfileCard, Email
  with pending / resend / cancel, Password via PasswordField + existing change-password) and
  `ConfirmEmailChangePage.tsx` (public `/confirm-email-change`, the emailed link). `/account` is
  one route rendered inside the signed-in role's own shell (`RoleShell` in App.tsx). Link: a
  `manage_accounts` icon next to logout in the admin sidebar footer, the driver/parent/monitor
  wide sidebar footer, and the phone header. Address shown for driver + parent only. Parent
  Profile tab now points to My account instead of "contact your company". Checked live on the
  local DB as driver (phone shell): request -> pending state -> link from dev mail log ->
  "Email changed" -> signed out. Admin: sidebar link + page, no console errors. `tsc -b` clean.
- **Task 4 done.** `server/src/services/usage.js` (one SQL for the counts, shared with the
  script), `GET /companies/me/usage` + `/me/billing` in `routes/companies.js` (router is already
  company_admin only). `server/scripts/snapshot-usage.js [--dry-run]`: claimed companies only,
  `ON CONFLICT (company_id, captured_on) DO UPDATE`, so a re-run the same day refreshes the row.
  Not scheduled. Client `pages/company/BillingPage.tsx` at `/company/billing`, Settings nav
  "Billing". Suite `33-usage-billing` (ports 5491 / 5992): 24 passed. Script run on the local DB:
  dry run (nothing written), then twice for real (3 rows, no duplicates). Page checked live.
  Note: restart the hand-started API after adding routes (now started with `node --watch`).
