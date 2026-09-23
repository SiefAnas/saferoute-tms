# Pending

Current list as of the access-scope pass (2026-09-23, branch `access-scope`, not merged yet).
One or two lines each. Access rules: `ACCESS_SCOPE_REPORT.md` and `API_CONTRACT.md` section 0.
Details: `MVP_FINISH_REPORT.md`, `V2_ROADMAP.md` (everything that's deliberately not in the MVP),
`API_CONTRACT.md` (for the mobile apps), `NEXT_STEPS.md`, `BACKLOG.md`.

## Needs Anas
- **Review + merge `access-scope`** (email failures never fail a request; every role sees only
  its own students, drivers narrowed to their own not-ended assignments). Then deploy and check
  `/health`. Report: `ACCESS_SCOPE_REPORT.md`.
- **Render SMTP vars (Resend)**: `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`/
  `MAIL_FROM` on the API service. Steps in `NEXT_STEPS.md` §1. Still unverified end to end.
- **`DATABASE_URL` sslmode**: `require` → `verify-full` on Render, on its own deploy, revert if
  the API can't connect. `NEXT_STEPS.md` §2.
- **Test data left in Neon** by the MVP-finish checks (all "MVP Test …" / `@example.test`,
  listed in `MVP_FINISH_REPORT.md`) and by the access-scope e2e run (`…muekdz3c…`, listed in
  `ACCESS_SCOPE_REPORT.md`). Delete when you like; nothing depends on it.

## Open decisions
- **Whose day does the app follow, Boston time or Cairo time?** Neon `SHOW timezone` = `GMT`
  (UTC), so the server's "today" flips to tomorrow at ~8pm Boston. Proposed fix: set the Neon
  database timezone (e.g. `America/New_York`). Not done, waiting on you.
- **Driver trip history**: `GET /trips` still shows a driver's own past trips even for students
  whose assignment has ended (only the `student_id`, the student is 404). Hide those too?
  (`ACCESS_SCOPE_REPORT.md` §6.1)
- **Schools see every field of their students** (address, notes) from any company. Matches the
  rule; say if some fields should be hidden from schools.
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
