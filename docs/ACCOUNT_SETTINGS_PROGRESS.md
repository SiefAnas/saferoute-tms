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
| 4 | Usage + billing (read only) | done | `0c8dca2` |
| 5 | Legal pages + acceptance | done | `874c5e3` |
| 6 | Closure, request side only | done | `bbffd94` |
| - | Final report | done | `752d699` |
| 7 | Legal documents on the server | done | `46c843c` |
| 8 | Remove the extra page (/company/account) | done | `be3c7fc` |
| 9 | Data deletion request button | done | `a9dbc2f` |
| 10 | license_number investigation (report only) | done | `d440769` |
| - | Report addendum | done | see log |

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
- **Task 5 done.** `client/src/legal/{terms,privacy}.md` (PLACEHOLDER text, frontmatter
  `version: 0.1-placeholder`, `effective: 2026-10-02`). `client/src/lib/markdown.ts` (tiny parser,
  no dependency, no HTML injection) + `client/test/markdown.test.ts` (18 passed, added to
  `npm test`). `lib/legal.ts` bundles the files with `?raw`. Public `/terms` and `/privacy`
  (`pages/legal/LegalPage.tsx`). `LegalLinks` in the login/auth footer, admin sidebar footer, wide
  driver/parent/monitor sidebar, and the phone shell footer. Register: required checkbox with both
  links; sends `acceptLegal`. Server: `services/legal.js` reads the same frontmatter, `signup()`
  requires `acceptLegal` (400 / 409 outdated), rows written in the signup transaction with
  `req.ip`. Suite `34-legal-acceptance` (5492 / 5993): 22 passed. Suites 03 / 07 / 25 updated where
  they expect a successful signup and pass; `scripts/e2e-roles.mjs` sends `acceptLegal` too.
  Checked live: unchecked box blocks submit; ticked -> company created, 2 rows with version + IP.
- **Task 6 done.** `server/src/services/closure.js`: request (password + exact name, 30-day
  purge date, `closing`, hashed undo token, all company sessions signed out, undo email) and undo
  (public, token, before the purge date). Refusal wired into `routes/auth.js` login (403) and
  `middleware/authenticate.js` (401), code `ACCOUNT_CLOSING`. Routes in `routes/companies.js`
  (undo declared before the auth chain). No purge, no delete anywhere; purge notes are in the
  questions file. Client: `pages/company/CompanyAccountPage.tsx` at `/company/account` (Settings >
  Company account) with the danger-zone modal (real counts, password, type the name, plain text);
  `UndoClosurePage.tsx` at `/company-closure/undo`; a one-time login notice
  (`setLoginNotice` / `peekLoginNotice` in `lib/auth.tsx`). Suite `35-company-closure`
  (5493 / 5994): 49 passed. Checked live on the local DB with a throwaway company: modal ->
  closed -> login shows the notice; login refused with the undo message; undo link -> "Account
  kept"; sign in again works. (Left undone on the local DB.)
- **Final report written** (`docs/ACCOUNT_SETTINGS_REPORT.md`). Full server run: all 34 suites
  pass (four needed a re-run after clearing stray embedded-Postgres `io_worker`s). Client build,
  tests and typecheck pass. Spec changelog line added. Everything is done; nothing pushed.

### Session 2 (2026-10-03)
- Checked first: `server/.env` DATABASE_URL host `localhost:5499`, db `saferoute_dev`, no sslmode;
  no DATABASE_URL in the shell. Local only.
- **Port 4000 is now used by someone else's API** (`node --watch src/index.js`, PID 8900/41956,
  started 2026-10-03 12:22, not from this session; I don't know which checkout or database it
  uses, so I left it alone). My old Vite on 5173 proxied `/api` to port 4000, so I stopped my own
  Vite. From now on: API `PORT=4100` and Vite `VITE_API_BASE_URL=http://localhost:4100 npx vite
  --port 5174`, both from this worktree, DATABASE_URL set explicitly to the local DB.
- Stray test Postgres processes: `clean-strays.ps1` in the scratchpad stops only this worktree's
  embedded-Postgres processes and keeps the dev DB (data dir `devdb-data`).
- **Task 7 done.** `server/src/legal/{terms,privacy}.md` (git mv; `client/src/legal/` deleted).
  `services/legal.js` rewritten: one source, `loadLegalDocuments()` validates both files,
  `getLegalDocument()`, no fallback. `routes/legal.js` mounted at `/legal` (public).
  `src/index.js` loads the documents before listening and exits 1 with `[legal] FATAL …` if it
  can't. Client: `lib/legal.ts` is now metadata + `useLegalDoc(id)` (fetch + parse);
  `LegalPage` and `RegisterPage` use it (register sends the versions it fetched). Tests: suite 34
  now reads `server/src/legal`, checks the endpoint (shape, values, 404s), and boots `index.js`
  with a missing / broken `LEGAL_DIR` (exit 1, message on stderr): 37 passed. 03 and 08 pass.
  Client markdown test no longer reads the files (12 passed). Checked live: API log
  `[legal] terms 0.1-placeholder, privacy 0.1-placeholder`, `/privacy` and `/register` fetch from
  `localhost:4100/legal/*`.
- **Task 8 done.** `CompanyAccountPage.tsx` renamed to `pages/company/CloseAccountSection.tsx`
  (the danger zone + the unchanged Close account modal). It renders only for `company_admin`, as
  its own `<section>` below the profile form: top rule, 24px gap, red-bordered card, red "Danger
  zone" heading, outside the `<form>`. `CompanyProfilePage` renders it after the ProfileCard. The
  `/company/account` route is now `<Navigate to="/company/profile" replace />`; the Settings nav
  item is gone. No server change; no test referenced the route. Checked live (5174 / 4100):
  `/company/account` lands on `/company/profile`, section below the form, red border computes
  (needed `!border-alert-fg/40` because Card sets `border-card-line`), modal opens; dismissed
  without submitting.
- **Task 9 done.** Migration 031 `deletion_requests` (id, user_id, company_id, reason ≤ 500,
  requested_at, status default `open` in (`open`,`closed`), handled_at, handled_by; one open per
  user via a partial unique index). Tested up / constraints / down / up on the local DB (re-checked
  the target host first: localhost:5499). Suite 01 count 30 -> 31. `services/deletionRequests.js`,
  routes `GET` / `POST /users/me/deletion-request` (driver/monitor/parent, verify limiter),
  `config.supportEmail` from new `SUPPORT_EMAIL`. Client: "Request my data be deleted" section on
  `/account` for those roles; shows the open request instead of the form. Suite
  `36-deletion-request` (5494 / 5995): 28 passed (happy path, duplicate, concurrent duplicate,
  closed-then-again, reason limits, roles, no SUPPORT_EMAIL). 01 and 32 pass. Checked live as
  `parent1@company1.com`: request sent, admin emailed (dev mail log), missing SUPPORT_EMAIL logged,
  state persists after reload. That local request is left open on the local DB.
- **Task 10 done (report only, no code change).** `docs/LICENSE_NUMBER_USAGE.md`: every read,
  write and display in server, client, mobile, imports, exports, tests, scripts and docs, plus
  whole-row reads checked for leaks (none). No remote branch has more references than `main`.
  Conclusion: no feature depends on the value; dropping it needs a code-first release, then the
  migration. Found (from reading, not reproduced) a pre-existing bulk-import update bug: fields a
  type doesn't have are written as NULL (staff `address`, and `license_number` for non-drivers).
- **Report addendum written.** Full server run: all 35 suites pass in one go. Client build/tests pass. Nothing pushed.
