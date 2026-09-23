# Overnight run, night 2 — report

## Summary

- **Finished:** item 0 (timezone fix, `1466859` + `555a328`), item 3 (`GET /schools` backend +
  tests, `f21343c`), item 6 (`PENDING.md`, `4167f9a`) and this report, committed last.
- **Undone:** item 1 (sidebar grouping). Built and checked visually, never committed, reverted
  with `git checkout` when the plan changed.
- **Cancelled, never started:** items 2 (empty states), 4 (card elevation), 5 (bottom check-in
  branch). No branch was created.
- **Tests at the last code commit (`f21343c`):** server 14/14 suites, 0 failures (04-resources
  now 87 checks); client `npm test` clean (payrollCycle 5, localDate 27 across 3 timezones);
  `tsc -b` and `vite build` clean. All run from PowerShell on this Windows machine.
- **Deploys:** every push deployed live on Render, `/health` = `{"status":"ok"}`, client
  loads. No revert needed.
- **Needs you:**
  1. Decide whose day the app follows (Neon is on `GMT`). Proposal:
     set the Neon DB timezone to `America/New_York`. See Item 0 below.
  2. Render SMTP vars + `sslmode` (unchanged, your manual job).
  3. The local `api` dev config points at production Neon (see "Found, not fixed").
- Final commit hash: see `git log -1` (this report's own commit, on top of `f21343c`).

## Status (updated as I go)

Mid-run change of plan from Anas: a second session does all frontend design work on another
branch, so frontend work stopped here.

| Item | Result |
|---|---|
| 0 — timezone fix | **Finished**, pushed (`1466859`, `555a328`) |
| 1 — sidebar grouping | **Undone.** Was built and checked visually, not committed; `git checkout` of `App.tsx` + `AdminLayout.tsx` when the plan changed. Nothing of it is in git. |
| 2 — empty states | **Cancelled**, not started (only a read-only survey of where "no data" text lives) |
| 3 — `GET /schools` | **Finished**, backend + tests only, pushed (`f21343c`). Frontend not touched. |
| 4 — card elevation | **Cancelled**, not started |
| 5 — bottom check-in branch | **Cancelled**, not started, no branch created |
| 6 — PENDING.md | **Finished**, pushed (`4167f9a`) |

No frontend commit was made tonight other than item 0's (which stays, as instructed).
`C:\Users\anas2\saferoute-design` and `C:\Users\anas2\projects\saferoute-tms` never touched.

---

## Item 0: timezone fix

- Start state: `git status` clean, `HEAD` = `origin/main` = `8ad508a`.
- The patch that first arrived (earlier version) had `TZ=... node` in the client `test` script,
  which fails on Windows (`'TZ' is not recognized...`, npm runs scripts through cmd.exe). That
  version was dropped: `git reset --hard 8ad508a`, then `git am` of the updated patch (TZ is set
  inside `localDate.test.ts` itself). Applied cleanly, two commits: `1466859` (server),
  `555a328` (client).
- Client: `npm test` clean from PowerShell — payrollCycle 5/5, localDate **27 passed** (9 checks
  x America/New_York, Africa/Cairo, UTC). Checked separately that setting `process.env.TZ`
  inside a running Node process really switches the offset on Windows (240 / -180 / 0 min), so
  the 27 are real, not the same timezone three times. `tsc -b` clean, `vite build` clean.
- Server: full suite **14/14, 0 failures**, run at ~9:50pm Eastern (inside the old 8pm–midnight
  bug window).
  - Honest note: the first server run had 3 suites fail (06, 12, 14) with
    `FATAL: pre-existing shared memory block is still in use` — their embedded Postgres never
    started, zero assertions ran. Cause: 6 orphaned embedded-Postgres `io_worker` processes
    (all from `server/node_modules/@embedded-postgres`, left behind by earlier test runs this
    evening) were holding shared memory. Stopped only those, re-ran, clean 14/14. Not a code
    issue, but it will bite again on this machine: see "Found, not fixed" below.
- `timezone-fix.patch` deleted from the repo root (never committed). Pushed `8ad508a..555a328`.
- Render: both deploys live on `555a328` (API `dep-dapj12jtqb8s73e9fmd0`, client
  `dep-dapj12jtqb8s73e9fmag`). `/health` = `{"status":"ok"}`, client loads, and the live JS
  bundle matches the local build (same size within 34 bytes, the API URL baked in at build).

### Neon (read-only): `SHOW timezone;`

**`GMT`** (i.e. UTC). At the time: `now()` = `2026-09-23 01:21:30+00`, `CURRENT_DATE` =
`2026-09-23` while it was still Sept 22, 9:21pm in Boston. Run inside `BEGIN READ ONLY`, then
rolled back. Nothing else queried.

What this means: the server half of the fix changes nothing in production today (with the DB on
GMT, `check_in_at::date` = the old `AT TIME ZONE 'UTC'`). The server's "today" in prod is still
the UTC day, so from ~8pm to midnight Eastern the server already says tomorrow while the client
(now using the browser's local date) says today.

### OPEN DECISION (needs you): what day does the app follow?

Proposed: set the Neon database timezone to `America/New_York` (one setting, e.g.
`ALTER DATABASE neondb SET timezone = 'America/New_York'`). Because the server patch makes every
"today" query follow the DB timezone, this single setting would move the whole server's day to
Boston time, matching the client. Not done tonight (no writes to Neon). Related question for
you: Boston time or Cairo time.

## Item 1 (undone) — note for the design session

The split I had used, in case it's useful: **Operations** = Dashboard, Assignments;
**Records** = Driver, Fleet, Students, Parents; **Admin** = Payroll, Company Profile (only
Assignments moved). Headings used the existing `text-label-md uppercase` pattern, collapsed
rail showed thin dividers instead of labels. Not in git.

## Item 3: `GET /schools` — backend + tests only

Turned out the endpoint already existed: shipped July 19 (commit `ad2d1d0`, BACKLOG
"Known-broken" #7), company_admin only, `{id, name}`, schools where the caller's company has
a student. The "Open — awaiting a decision" BACKLOG entry was stale. What was added tonight:

- **Placeholder schools included** (`server/src/services/schools.js`): a school the company
  created via `POST /placeholders/school` (creator is one of the company's users) is listed
  even before any student is added there. Scoped the same way, so it still can't list
  unrelated schools.
- **New tests** in `server/test/04-resources.test.cjs` (82 → 87 checks): company A sees its
  own placeholder; response is exactly `id`+`name`; company A does NOT see a school where only
  company B has students, nor B's placeholder; company B sees exactly its own two. The existing
  403 tests (school_admin, driver) and 401 stay. Negative control: against the old query the
  new checks fail (84 passed, 3 failed), with the new query 87/87.
- BACKLOG entry updated to DONE.
- **Frontend: not touched** (per the change of plan). Note: the company Students page picker
  already calls `GET /schools` and shows names (since July 19), so no frontend work is
  strictly needed. With tonight's change it will also show the company's own placeholder
  schools. If the design branch rebuilds that picker, it should keep using `GET /schools`.

## Found, not fixed

- **Embedded-Postgres test instances leak `io_worker` processes on Windows.** After a suite
  finishes, a `postgres.exe --forkchild="io_worker"` child can stay alive and hold the shared
  memory block, so a later suite fails to start its DB (`pre-existing shared memory block is
  still in use`) and shows as FAIL with zero assertions run. Workaround tonight: stop stray
  `postgres.exe` processes whose path is under `server/node_modules/@embedded-postgres` before
  a run. A real fix belongs in the test harness teardown, not done.
- **The local `api` dev config points at production.** `.claude/launch.json`'s `api` entry
  runs `npm --prefix server run dev`, which loads `server/.env`, whose `DATABASE_URL` is the
  Neon database. So starting the local API (or any preview tool that uses that config)
  reads/writes real data. Tonight I avoided it and used a throwaway fake API from outside the
  repo instead. Worth a separate local `.env` or a dev DB.
