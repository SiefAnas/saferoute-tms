# SafeTurns: Bulk Import and Account Lifecycle Spec

Status: **built** (branch `bulk-import`, 2026-09-29). Agreed design dated 2026-09-29, originally
targeted for October 2026 after the 3 Bees pilot; started early.
Lines marked DEFAULT were recommendations; the value used is noted.

## 1. Who can do what
- B2B only. No self sign up for drivers, monitors, parents or staff.
- Company admin imports drivers, monitors, parents, vans and students for their own company.
- School admin imports school staff for their own school. Never drivers or vans.
- Nothing crosses tenants. An email that belongs to another company/school is a row error
  ("already registered to another account"), with no detail about whose it is.

## 2. Accounts and passwords
- Email is the login ID: required, unique across the app.
- The server generates temporary passwords and stores only the hash. The plain list comes back
  once, in the import result (table of name, email, temporary password, plus Download). It is
  never shown again; a lost list is fixed with Reset password on that person.
- New accounts have `must_change_password = true`, enforced server-side on every route except
  change-password (and `/auth/me`).
- Temporary passwords expire after **7 days** (DEFAULT, used). Expired → login answers
  `TEMP_PASSWORD_EXPIRED`; only an admin reset helps.

## 3. Password reset
- Both stay: self service by email, and admin reset.
- Rate limits: per IP (5 / 15 min) and per email (3 / hour).
- Reset link: **1 hour, single use** (DEFAULT, used). Only the newest link works.
- The forgot-password page never reveals whether an account exists.
- Every reset is logged in `password_reset_log`: actor (null for self service), target, method, time.

## 4. Email health and account status
- `users.email_bounced`: set by the bounce webhook (`POST /webhooks/email-bounce`). Mail to that
  address stops; admins see a warning on the account. Correcting the email clears it.
- Account status shown to admins: **Created** (temporary password not replaced yet),
  **Never logged in** (temporary password expired unused), **Active**.
  Backed by `users.last_login_at` and `users.temp_password_expires_at`.

## 5. Deactivation
- Terminate = `is_active = false`. Never delete. Deactivated users can't log in and drop out of
  assignment lists; their history stays.
- Blocked while a driver/monitor has running or future assignments:
  "This driver has N active assignments. Reassign them before deactivating."
- Parents are never deleted.

## 6. Import flow (website only, not the mobile app)
One screen (`/company/import`, `/school-admin/import`), four steps:
1. Pick the type from a dropdown (no guessing).
2. Upload .csv/.xlsx/.xls, map columns to SafeTurns fields. The mapping is remembered per
   company/school and type (DEFAULT, used; table `import_mappings`).
3. Preview every row: will create / will update / error with reason; counts on top; nothing written.
4. Confirm: good rows are imported, bad rows are not. Result counts, the one-time password table,
   and a downloadable error file: the original rows as uploaded plus one Error column.

## 7. Import rules
- Match by email (drivers, monitors, parents, staff) and license plate (vans, case-insensitive).
  Update, don't duplicate. Created and updated are counted separately.
- Never deactivate from a file. Deactivated accounts in a file are row errors.
- Duplicate emails (or plates, van numbers, students) inside one file: every such row is an error.
  Never renamed or merged.
- Students may have no driver or van. If a student row's parent (by `parent_email`) doesn't
  exist, the parent account is created from that row and linked.
- Order: schools → drivers/monitors → parents → vans → students. A missing dependency (e.g. an
  unknown school) is a row error, never a crash.

## 8. Limits and reading rules
- Max **100 rows** per file, with a split-the-file message. Empty file or no header: clear error.
- Every cell read as text (`raw: false`), `cellDates: true`, first sheet only, headers trimmed,
  empty rows skipped.

## 9. Out of scope
Auto-detecting the file type, multi-file upload, rolling back a completed import.

## 10. Implementation notes and open decisions
- The browser parses and maps the file (SheetJS 0.20.3 from the official CDN tarball; the npm
  `xlsx` package is stale). The server re-validates on commit with the same planning code as
  preview, so they can't disagree; there is no server-side preview state.
- Each good row is written in its own transaction, so one failing row never undoes the others.
- Import hashes temporary passwords with bcrypt cost 10 (normal accounts use 12) to keep a
  100-row import fast; they are random and must be replaced at first login.
- **Open: school-admin student import is not built.** `students.company_id` is NOT NULL, and a
  school can't pick which company carries a student. Needs a product decision.
- **Open: student rows have no driver/van columns.** Assign after import on the Assignments page.
- **DEFAULT chosen here:** a student is matched by full name + school (the spec named no key).
  Two existing students with the same name at one school make that row an error.
- Students need the school to exist already (matched by exact name among the company's schools).
- Deploy: migration `1752624000025_bulk-import-lifecycle` must be applied to Neon; set
  `BOUNCE_WEBHOOK_SECRET` and point the mail provider's bounce webhook at `/webhooks/email-bounce`.
