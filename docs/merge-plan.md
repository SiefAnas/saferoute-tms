# Merge plan

Date: 2026-09-30. Based on `origin/main` at `47dd95c`. Conflicts were found with `git merge-tree`
(an in-memory merge that changes no branch). No rehearsal merge was run, because of the "never
merge" rule. Tell me if you want one on a throwaway detached worktree.

## What to merge, and what not to
| Branch | Merge? | Adds migration | Why |
|---|---|---|---|
| `fix-placeholder-claim` | **Yes, 1st** | 028 | Critical security fix. Also brings the tenant isolation suite (25) |
| `fix-student-school-scope` | **Yes, 2nd** | — | Security fix (students only at linked schools) |
| `fix-delete-500s` | **Yes, 3rd** | — | 409 instead of 500 on delete |
| `resend-bounce-webhook` | **Yes, 4th** | — | Needs env var `RESEND_WEBHOOK_SECRET` |
| `payroll-currency-import` | **Yes, 5th** | — | Client only |
| `student-id-scope-change` | **Yes, 6th** | 026, 029 | Contains the `student-id` commit plus the per-company change |
| `duplicate-student-flag` | **Yes, 7th** | 027 | |
| `overnight-reports` | **Yes, last** | — | Docs only |
| `student-id` | **No** | (026) | Superseded by `student-id-scope-change`; merging both makes conflicts and undoes the scope change |
| `tenant-isolation-audit` | **No** | — | Its only file (suite 25) arrives, updated, with branches 1 and 2 |
| `wip-backup-sept29` | **No** | — | Safety backup marked "do not merge" |

## Migrations for production
- **Before anything:** confirm `025` is applied on Neon (`SELECT name FROM pgmigrations ORDER BY id`).
  The last row should be `1752624000025_bulk-import-lifecycle`.
- **After all merges:** 026, 027, 028, 029, in that order, in **one** `npm run migrate:up`
  run (node-pg-migrate applies pending files in number order in a single transaction).
- **The order matters:** 029 drops the index 026 creates. Run them together in number order,
  never 029 on its own.
- **Don't apply 028 alone before 026/027 exist.** node-pg-migrate refuses to run a migration
  numbered below one already applied ("Not run migration … is preceding already run migration
  …"). If the critical fix has to go live before the Student ID work is ready, see "Fast path" below.

## Checklist
Before each merge: `git switch main && git pull`. After each merge, run the checks listed in that step:
- **Server:** `cd server && npm test` (all suites, ~15 min; run one suite with `node test/NN-*.test.cjs`)
- **Client:** `cd client && npm test && npx tsc -b && npx vite build`

### ☐ 1. `fix-placeholder-claim`
- Merges cleanly into `main`.
- **Test:** server suite; suites 03, 07 and 25 in particular.
- **By hand (local):**
  - Register page: "Create new" still creates a company or school.
  - `POST /signup/school` with a `claimId` answers 403.
  - `node scripts/claim-requests.js list` runs against a local DB.

### ☐ 2. `fix-student-school-scope`
- **Conflict:** `server/test/25-tenant-isolation.test.cjs`. Both branches edited the same file.
  **Resolve:** take this branch's file, then replace its whole "Gap 2" block (from
  `// Gap 2: anyone can claim` up to `// Gap 3 (low):`) with the "Gap 2 — FIXED" block from `main`.
  Result: FIXED 1, FIXED 2, KNOWN GAP 3.
- **Test:** server suite; suites 25 and 30.
- **By hand:** on the Students page, add a student at one of your schools, and with "new school".

### ☐ 3. `fix-delete-500s`
- **Conflict:** `API_CONTRACT.md`, two adjacent table rows (vans and students).
  **Resolve:** keep both new texts: the students row sentence about `school_id` and the vans row
  sentence about `409 VAN_HAS_HISTORY` / `STUDENT_HAS_HISTORY`.
- `server/src/app.js` has the same edit on both sides; Git takes it once.
- **Test:** server suite; suite 31.
- **By hand:** delete a van that has assignments on the Fleet page. The API now answers 409 with
  an explanation. Check that the page shows that message; I didn't check how the Fleet page
  displays delete errors.

### ☐ 4. `resend-bounce-webhook`
- Merges cleanly.
- **Test:** server suite; suites 24 and 28.
- **Deploy:**
  - Set `RESEND_WEBHOOK_SECRET` on the Render API service (the `whsec_…` secret of a Resend webhook
    for `email.bounced`, pointing at `https://<api>/webhooks/email-bounce`).
  - Remove `BOUNCE_WEBHOOK_SECRET` if it was set.

### ☐ 5. `payroll-currency-import`
- Merges cleanly.
- **Test:** client tests (`money.test.ts`) plus build.
- **By hand:** on the Payroll page, import rates from an Excel sheet with a "$12.50" cell.

### ☐ 6. `student-id-scope-change`
- **Conflict:** `server/test/01-schema.test.cjs` (expected migration count).
  **Resolve:** set it to **28** (25 on `main` + 026, 028, 029).
- **Test:** server suite; suites 01, 26 and 30. Client build.
- **By hand:**
  - A Student ID field on the Students form.
  - "ID …" in the company and school lists.
  - An import with a Student ID column.

### ☐ 7. `duplicate-student-flag`
- **Conflicts:**
  - `server/test/01-schema.test.cjs`: set it to **29** (all four migrations).
  - `client/src/types/api.ts`: keep both new `Student` fields (`student_id` and `duplicate_name`).
  - `client/src/pages/company/StudentsPage.tsx` and `client/src/pages/school-admin/StudentsPage.tsx`:
    each side changed the same `NameCell sub=…` line and the drawer rows. Keep both:
    - `sub` shows the grade, then `ID …` if any, then the "Possible duplicate" badge.
    - The drawers keep both the "Student ID" row and the "Possible duplicate" row.
    - Search keeps `s.student_id`.
- `server/src/services/bulkImport.js` merges cleanly (different parts of `execStudent`). Check that
  `execStudent` still ends with `return studentId` and that `commit` still returns `duplicates`.
- **Test:** server suite; suites 01, 26 and 27. Client `tsc -b` and build.
- **By hand:** two students with the same name at one school both get the badge. The ID still
  shows next to the grade.

### ☐ 8. `overnight-reports`
- Docs only.

### ☐ 9. Deploy
1. Take a Neon branch or snapshot named `before-026-029`.
2. Deploy `main` on Render. Deploys may be manual: auto-deploy was recorded as broken in July.
3. From `server/`, with `DATABASE_URL` pointing at Neon: `npm run migrate:up`. It should list
   026, 027, 028 and 029, then "Migrations complete".
4. Smoke test:
   - `/health`.
   - Log in as a company admin.
   - The Students page shows no errors.
   - `POST /signup/school/claim-requests` answers 202 for a placeholder.
5. If a migration fails: nothing was applied (single transaction). Fix it and redo.
   For code problems, redeploy the previous commit on Render.

## Fast path (critical fix first, rest later)
1. Merge steps 1–3 and deploy. **Don't run migrations yet.**
   - The self-claim hole is closed by code alone.
   - Only claim *requests* fail (500) until 028 is applied. An error there is safer than the hole.
2. Merge steps 4–7 when ready, then run `npm run migrate:up` once, so 026–029 are applied in order.
   If you'd rather apply 028 right away instead, ask me first to renumber the Student ID and
   duplicate migrations above 028 (026 → 030, 029 → 031, 027 → 032) on their branches. Otherwise
   the later run will refuse to apply 026 and 027.
