# Pending

Current list as of the MVP-finish pass (2026-09-23, branch `mvp-finish`). One or two lines each.
Details: `MVP_FINISH_REPORT.md`, `V2_ROADMAP.md` (everything that's deliberately not in the MVP),
`API_CONTRACT.md` (for the mobile apps), `NEXT_STEPS.md`, `BACKLOG.md`.

## Needs Anas
- **Render SMTP vars (Resend)**: `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`/
  `MAIL_FROM` on the API service. Steps in `NEXT_STEPS.md` §1. Still unverified end to end.
- **`DATABASE_URL` sslmode**: `require` → `verify-full` on Render, on its own deploy, revert if
  the API can't connect. `NEXT_STEPS.md` §2.
- **Test data left in Neon** by the MVP-finish checks (all "MVP Test …" / `@example.test`,
  listed in `MVP_FINISH_REPORT.md`). Delete when you like; nothing depends on it.

## Open decisions
- **Whose day does the app follow, Boston time or Cairo time?** Neon `SHOW timezone` = `GMT`
  (UTC), so the server's "today" flips to tomorrow at ~8pm Boston. Proposed fix: set the Neon
  database timezone (e.g. `America/New_York`). Not done, waiting on you.
- **Drivers can read every student in their company** (`GET /students`, `/students/:id`), not
  only the ones assigned to them. Same as before; tighten to assigned students? (small server change)
- **Driver account flow** (for the mobile app): today a company admin creates each driver and sets
  their password; there's no self-registration, invite link or password reset. Decide the mobile
  flow (see `MVP_FINISH_REPORT.md`, step 6).
- **Seed accounts in `PROJECT_STATE.md` are stale**: Neon now holds different demo companies
  (Blue Ridge, Metro, Sunrise) and no "3 Bees"; the documented logins don't work.

## V2 (not MVP)
See `V2_ROADMAP.md`. The app shows **Coming soon** for: driver week schedule, live map, parent
live ETA / "stops away", payment history ("Paid in {month}"), On time / Late status.

## Deliberate decisions (documented in BACKLOG, not bugs)
- Student form's multi-row parent/guardian entry is create-only; edit keeps one primary
  parent pair plus the separate Contacts panel.
- CSV import is add-only for students (no update/merge of existing rows).
- No alert system beyond the dashboard's "Needs attention" list (10-hour open shift, no-shows,
  waiting trips, drivers not in, missing pay rates).
- Create/edit forms stay as modals for the MVP (design wanted them in the drawer).

## Known issues
- **`node-pg-migrate` audit warnings**: transitive high-severity advisories (`glob`,
  `brace-expansion`, `ip-address`); `npm audit fix --force` wants a breaking major bump. Needs
  a dedicated look before go-live.
- **Local test harness on Windows**: embedded-Postgres `io_worker` processes can be left
  running and make later suites fail or hang ("shared memory block is still in use"). Kill stray
  `postgres.exe` from `server/node_modules/@embedded-postgres` and re-run.
- **Local `api` dev config uses production Neon** (`server/.env`). Needs a separate dev DB or
  local env before anyone runs the API locally for testing.

## Branding
- Name availability check for the product/company name.
- 7D vehicle classification search.
