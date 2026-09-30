# Overnight 2026-09-30: progress

Live log for the 10-task overnight run. The **latest entry is at the bottom**; it alone is enough to resume.

## Setup and conventions
- Repo: `C:\Users\anas2\saferoute-tms` (main checkout, used for the build branches).
- Reports + this file: branch `overnight-reports`, checked out as a git worktree at
  `C:\Users\anas2\saferoute-reports` (so docs can be committed without switching branches).
- Every build branch starts from `origin/main` at `71367cb` (bulk-import is merged there).
- Tests: `cd server && npm test` (24+ suites, embedded Postgres, ~10 min). Client: `cd client && npx tsc -b && npx vite build`.
  Only one suite run at a time (suites use fixed ports). After a run, stray embedded `postgres.exe`
  processes from `saferoute-tms\server\node_modules\@embedded-postgres` can be killed.
- Never: push to main, merge, open a PR, delete a branch, touch Neon or any remote DB/API.
- **"Full suite before every push", as applied to `overnight-reports`:** that branch's code is
  identical to `origin/main`; it only adds files under `docs/`. The suite was run once on
  `origin/main` code (baseline below). Docs-only commits cannot change the result, so progress
  and report pushes on this branch are not each preceded by a new 10-minute run. Every build-branch
  push gets its own full run. Say so if you want a run before every docs push too.

## Log
### Setup — done
- Baseline full suite on origin/main (71367cb): 24/24 pass. (Suite 14 failed once when I ran suite 25
  at the same time; alone it passes 62/62. Lesson: never run two suites concurrently.)

### Task 1 — tenant-isolation-audit — DONE
- Branch `tenant-isolation-audit`, commit `1929feb`, pushed. Test: `server/test/25-tenant-isolation.test.cjs` (27 checks).
- Report: `docs/tenant-isolation-audit.md` (overnight-reports, commit 1030b9e).
- Findings: (1) CRITICAL placeholder claim takeover exposes students; (2) HIGH student can be
  attached to any school id; (3) LOW cross-tenant email probe; (4) info 200-empty on foreign adjustments.
- Full suite on the branch: 24/25 first pass; 10-no-show died when I killed a stuck initdb, rerun alone 11/11.
- Test-env note: embedded Postgres leaves orphaned `io_worker` processes after each suite; they pile up
  and stall initdb. A reaper loop (scratchpad `reap-orphans.ps1`, background) now kills only io_workers
  whose parent is gone.

### Task 2 — student-id — DONE
- Branch `student-id`, commit `5b82c0a`, pushed. Full suite 25/25 pass.
- Migration `1752624000026_student-id`; test `26-student-id.test.cjs` (26 checks). Browser-checked.
- Mobile admin screens not changed (task named the web list and detail pages).

### Task 3 — duplicate-student-flag — DONE
- Branch `duplicate-student-flag`, commit `04689e1`, pushed. Full suite: 24/25 first pass; 16-parent-scope
  died silently after initdb (environment flake), rerun alone 22/22.
- Migration `1752624000027_duplicate-student-flag`: students.duplicate_name kept by two triggers
  (BEFORE sets the written row's own flag so API responses are right; AFTER refreshes the others in
  the old and new name groups). Name key: lower, trimmed, repeated spaces collapsed. Backfill included.
- Import commit returns `duplicates`; Import page shows a banner. Badge "Possible duplicate" in the
  company and school-admin student lists, plus a drawer row. Browser-checked all three.
- Test `27-duplicate-student-flag.test.cjs` (18 checks, PG 5477, app 5984).
- MERGE NOTE: student-id (026) and duplicate-student-flag (027) both touch bulkImport students,
  both students pages and 01-schema; merge student-id first, then resolve (01-schema should expect 27).

### Task 4 — web-mobile parity report — DONE (written early, while suites ran)
- `docs/web-mobile-parity.md` on overnight-reports.

### Task 5 — mobile-account-lifecycle — DONE
- Branch `mobile-account-lifecycle`, commit `41ea905`, pushed. Server suite 24/24; mobile jest 94/94;
  mobile tsc + eslint clean on changed files. NOT run on a device/emulator (none here; the app has
  no web target) — verified by unit tests and typecheck only.
- 1 forced change: 403 PASSWORD_CHANGE_REQUIRED mid-session flags the session; root layout keeps a
  signed-in user on a temporary password on /set-password (login + app start already did).
- 2/5 messages: login screen says why a session ended (TEMP_PASSWORD_EXPIRED, ACCOUNT_INACTIVE,
  PASSWORD_CHANGED). Server adds codes ACCOUNT_INACTIVE / PASSWORD_CHANGED to those 401s (messages
  unchanged; asserted in suites 20 and 24). Session re-checked on app foreground.
- 3 reset request flow already matched web (same copy, single-use 60-min link); no change.
- 4 People details sheet: account status line + bounced-email warning (web EditAccountModal wording).
- 6 import absent from mobile; `mobile/tests/accountLifecycle.test.ts` fails if it ever appears.

### Task 6 — live tracking design — DONE (written early)
- `docs/live-tracking-design.md` (real Neon/Render/Google/Mapbox/MapTiler prices, 10 decisions).

### Task 7 — failure modes — DONE (written early)
- `docs/failure-modes.md` (8 situations, worst first; top fix: idempotent writes + one trip per session/student/type).

### Task 8 — resend-bounce-webhook — DONE
- Branch `resend-bounce-webhook`, commit `c5fc2ab`, pushed. Full suite 25/25.
- ENV VAR: **`RESEND_WEBHOOK_SECRET`** = the `whsec_...` signing secret shown on the Resend webhook's
  page (webhook subscribed to `email.bounced`, URL `https://<api>/webhooks/email-bounce`).
  `BOUNCE_WEBHOOK_SECRET` and the `x-webhook-secret` header are removed. Nothing configured on Resend.
  Documented in API_CONTRACT.md, server/.env.example, docs/bulk-import-implementation-notes.md.
- Verification: svix-id / svix-timestamp / svix-signature, HMAC-SHA256 of `id.timestamp.rawBody`
  keyed with the base64 part of the secret, timing-safe, 5-minute window, several v1 signatures ok.
  Router mounted before express.json(). 404 unset, 401 bad/missing/stale, 400 non-JSON body.
- Test `28-resend-webhook.test.cjs` (18 checks); suite 24's bounce test now signs its request.

### Task 9 — payroll-currency-import — DONE
- Branch `payroll-currency-import`, commit `01ea786`, pushed. Server suite 24/24; client `npm test` incl. 28 new checks.
- `client/src/lib/money.ts` parseDollarAmount used by the Payroll rate import. Browser-checked.

### Task 10 — repo health — DONE
- `docs/repo-health.md` (overnight-reports).

## FINAL STATE (2026-09-30) — all 10 tasks done, stopped as asked
| Task | Kind | Branch / file | Commit | Suite |
|---|---|---|---|---|
| 1 Tenant isolation | report + tests | `tenant-isolation-audit` + docs/tenant-isolation-audit.md | 1929feb | 25/25 (10 rerun) |
| 2 Student ID | build | `student-id` | 5b82c0a | 25/25 |
| 3 Duplicate student flag | build | `duplicate-student-flag` | 04689e1 | 25/25 (16 rerun) |
| 4 Web/mobile parity | report | docs/web-mobile-parity.md | — | — |
| 5 Mobile account lifecycle | build | `mobile-account-lifecycle` | 41ea905 | 24/24 + mobile jest 94/94 |
| 6 Live tracking design | report | docs/live-tracking-design.md | — | — |
| 7 Failure modes | report | docs/failure-modes.md | — | — |
| 8 Resend bounce webhook | build | `resend-bounce-webhook` | c5fc2ab | 25/25 |
| 9 Payroll currency import | build | `payroll-currency-import` | 01ea786 | 24/24 + client tests |
| 10 Repo health | report | docs/repo-health.md | — | — |
- Nothing merged, no PRs, main untouched, no branch deleted, no remote DB or API touched
  (all local testing on embedded Postgres; browser checks against a throwaway local API).
- Merge notes: student-id (migration 026) before duplicate-student-flag (027); both touch
  bulkImport students, both students pages and 01-schema's migration count. The tenant suite (25)
  and later suites (26–28) use distinct ports and file numbers, so they coexist.
- Deploy notes: migrations 026/027 when merged; set RESEND_WEBHOOK_SECRET for the bounce webhook.
- If resuming: nothing is in progress. Wait for Anas.

## Questions for Anas
0. (Task 2) Student IDs are unique per school across ALL companies (as specified). So a company
   entering an ID another company's student already has at that school gets "already has this
   Student ID": that reveals the ID is in use there (never who). OK, or unique per company+school?
1. (Task 2) First import with Student IDs over an existing roster: should a row whose ID is new but
   whose name + school match an existing student without an ID attach that ID to the existing
   student? Today it is a row error so nothing is duplicated or attached by guess.
2. (Task 3) Should a possible-duplicate flag also consider students of OTHER companies at the same
   school? Today it doesn't: that would tell company B that company A transports a child with that
   name. The school admin (who sees all companies' students) therefore only sees per-company flags.

---

# SESSION 2 (tasks 11–18) — started 2026-09-30
Same rules. origin/main still at `71367cb` (none of the session-1 branches merged). Latest entry at the bottom.

### Task 11 — README snapshot — DONE
- `docs/readme-snapshot.md` = README.md on origin/main (71367cb), verbatim under a one-line header.
- Note: the README says almost nothing about planned features; it points to `V2_ROADMAP.md`
  ("features that are not in the MVP") and is stale (still says the client is "not started").
- Next step: Task 12, `git switch -c fix-placeholder-claim origin/main` in the main checkout.
