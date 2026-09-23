# Pending

Real current list as of the end of night 2 (2026-09-22). One or two lines each. Details live
in `OVERNIGHT_REPORT_2.md`, `NEXT_STEPS.md` and `BACKLOG.md`.

## Needs Anas (manual, dashboard access)
- **Render SMTP vars (Resend)**: `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`/
  `MAIL_FROM` on the API service. Steps in `NEXT_STEPS.md` §1. Still unverified end to end.
- **`DATABASE_URL` sslmode**: `require` → `verify-full` on Render, on its own deploy, revert if
  the API can't connect. `NEXT_STEPS.md` §2.

## Open decisions
- **Whose day does the app follow, Boston time or Cairo time?** Neon `SHOW timezone` = `GMT`
  (UTC), so the server's "today" flips to tomorrow at ~8pm Boston. Proposed fix: set the Neon
  database timezone (e.g. `America/New_York`); one setting, the server already follows it
  after tonight's timezone patch. Not done, waiting on you.

## Frontend (moved to the design session's branch)
- Night 2 items 1 (sidebar grouping), 2 (empty states), 4 (card elevation) and 5 (bottom
  check-in branch) were cancelled here; item 1 was built then undone, nothing in git. No
  `driver-bottom-checkin` branch exists.
- `GET /schools` now also lists the company's own school placeholders; the Students page
  picker already uses the endpoint, so the design branch should keep calling it.

## Deliberate decisions (documented in BACKLOG, not bugs)
- Student form's multi-row parent/guardian entry is create-only; edit keeps one primary
  parent pair plus the separate Contacts panel.
- CSV import is add-only for students (no update/merge of existing rows).
- No alert system beyond the 10-hour "still checked in" flag on the dashboard.

## Known issues
- **`node-pg-migrate` audit warnings**: transitive high-severity advisories (`glob`,
  `brace-expansion`, `ip-address`); `npm audit fix --force` wants a breaking major bump. Needs
  a dedicated look before go-live.
- **Local test harness on Windows**: embedded-Postgres `io_worker` processes can be left
  running and make later suites fail with "shared memory block is still in use" (0 checks
  run). Kill stray `postgres.exe` from `server/node_modules/@embedded-postgres` and re-run.
- **Local `api` dev config uses production Neon** (`server/.env`). Needs a separate dev DB or
  local env before anyone runs the API locally for testing.

## Branding
- Name availability check for the product/company name.
- 7D vehicle classification search.
