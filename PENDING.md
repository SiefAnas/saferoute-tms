# Pending

Current list as of 2026-09-24: everything up to `mobile-admin-roles` is merged to `main` and live
(migrations 022, 023, 024 run on Neon).
One or two lines each. Access rules: `ACCESS_SCOPE_REPORT.md` and `API_CONTRACT.md` section 0.
Details: `MVP_FINISH_REPORT.md`, `V2_ROADMAP.md` (everything that's deliberately not in the MVP),
`API_CONTRACT.md` (for the mobile apps), `NEXT_STEPS.md`, `BACKLOG.md`.

## Needs Anas
- **Email from Render (branch `email-timeout`)**: every send now has a hard 15 s limit
  (`MAIL_TIMEOUT_MS`) and logs `[mail] sent …` / `[mail] send failed … reason=…`. Optional
  Resend HTTP API transport: set `RESEND_API_KEY` on the API service (it wins over SMTP) to send
  over HTTPS instead of SMTP. Sending to anyone but your own Resend address needs a verified
  domain in Resend and `MAIL_FROM` on that domain.
- **Test data left in Neon** by the MVP-finish checks (all "MVP Test …" / `@example.test`,
  listed in `MVP_FINISH_REPORT.md`), by the access-scope e2e run on the local API (`…muekdz3c…`,
  listed in `ACCESS_SCOPE_REPORT.md`) and by the live e2e check after the merge (`…muelscel…`:
  companies "MVP Test Transport/Other Co muelscel", school "MVP Test Elementary muelscel",
  placeholder "MVP Test School muelscel", drivers/parent/staff `mvp-*-muelscel@example.test`,
  vans `MVP-muelscel`/`MVP2-muelscel`, 4 students, 4 assignments, 1 session, 1 trip).
  Delete when you like; nothing depends on it.

## Open decisions
- **Seed accounts in `PROJECT_STATE.md` are stale**: Neon now holds different demo companies
  (Blue Ridge, Metro, Sunrise) and no "3 Bees"; the documented logins don't work.

## V2 (not MVP)
See `V2_ROADMAP.md`. The app shows **Coming soon** for: driver week schedule, live map, parent
live ETA / "stops away", payment history ("Paid in {month}"), On time / Late status.

## Done (2026-09-24, by Anas)
- `APP_URL` set on Render (API service): reset-password links point at the live site.
- SMTP vars (Resend) set on Render.
- `DATABASE_URL` sslmode updated.
- Neon database timezone set to `America/New_York`, so the server's "today" follows Boston time.

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
