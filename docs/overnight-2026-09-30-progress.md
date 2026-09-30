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

### Task 2 — student-id — in progress (code done, full suite running)
- Branch `student-id` from origin/main, commit `5b82c0a` (not pushed until the suite passes).
- Migration `1752624000026_student-id` (students.student_id text, 1-50 chars, unique index
  `students_school_student_id_unique` on (school_id, lower(student_id)) where not null).
- Server: POST/PATCH /students accept student_id (409 on a used ID). Import: "Student ID" column,
  ID+school match, duplicate ID in file = row error, name+school fallback, no case rewrite on match.
- Client: company + school-admin list ("Grade 3 · ID S-001"), drawers, search, company form field,
  students CSV column. Browser-checked both admin screens and the 409 message.
- Test: `server/test/26-student-id.test.cjs` (26 checks, PG 5476, app 5983). 01-schema expects 26 migrations.
- Not done on purpose: mobile admin screens unchanged (task named web list/detail; mobile untouched).
- Next step: when the suite passes, `git push -u origin student-id`, then Task 3.

## Questions for Anas
0. (Task 2) Student IDs are unique per school across ALL companies (as specified). So a company
   entering an ID another company's student already has at that school gets "already has this
   Student ID": that reveals the ID is in use there (never who). OK, or unique per company+school?
1. (Task 2) First import with Student IDs over an existing roster: should a row whose ID is new but
   whose name + school match an existing student without an ID attach that ID to the existing
   student? Today it is a row error so nothing is duplicated or attached by guess.
