# Pending

Current list as of 2026-09-23: `access-scope`, `v2-week-schedule` and `mobile-app` merged to `main` and live.
One or two lines each. Access rules: `ACCESS_SCOPE_REPORT.md` and `API_CONTRACT.md` section 0.
Details: `MVP_FINISH_REPORT.md`, `V2_ROADMAP.md` (everything that's deliberately not in the MVP),
`API_CONTRACT.md` (for the mobile apps), `NEXT_STEPS.md`, `BACKLOG.md`.

## Needs Anas
- **Review `auth-accounts`**: temporary passwords with a forced change at first login, forgot /
  reset password, admin reset, old sessions end after a change; web + mobile screens. Report:
  `AUTH_ACCOUNTS_REPORT.md`. It has a migration (021, additive): run `npm run migrate:up`
  against Neon when you merge, before or with the deploy.
- **`APP_URL` on Render (API service)**: the website address for the reset-password link, e.g.
  `https://saferoute-tms-client.onrender.com`. Without it the link uses the first
  `ALLOWED_ORIGINS` entry, which is the same site today.
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
- **Seed accounts in `PROJECT_STATE.md` are stale**: Neon now holds different demo companies
  (Blue Ridge, Metro, Sunrise) and no "3 Bees"; the documented logins don't work.

## V2 (not MVP)
See `V2_ROADMAP.md`. The app shows **Coming soon** for: driver week schedule, live map, parent
live ETA / "stops away", payment history ("Paid in {month}"), On time / Late status.

## Deliberate decisions (documented in BACKLOG, not bugs)
- **Access scope decisions (Anas, 2026-09-23):** a driver keeps seeing their own past trips even
  for students no longer theirs (own work history, needed for pay questions; only the
  `student_id`). Schools see their students' address and notes (they enrolled the child; staff
  only see granted children). The mobile Week screen will call `GET /schedule/week?start=`.
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
