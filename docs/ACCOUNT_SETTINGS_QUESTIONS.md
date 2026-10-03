# Account settings: open questions

Things I could not answer from the code or the task, with what I did in the meantime.
Branch `account-settings`.

## Migration 030

1. **`billing_status` values.** The DB allows only `free` and `closing` (CHECK constraint), and
   `billing_plan` only `pilot`. Those are the only values the code uses. Real plans will need a
   migration to widen them. OK, or do you want a wider list now (e.g. `trial`, `active`, `past_due`)?
2. **Undo restores `billing_status` to what?** The task says "restores billing_status", but the
   schema has no column for the status before closure. With only `free` in use, undo sets `free`.
   When paid plans exist this needs a `billing_status_before_closure` column (or similar).
3. **`legal_acceptances.user_id` has no ON DELETE CASCADE**, on purpose: a legal record should
   not disappear as a side effect of deleting a user. This means the future purge must decide
   explicitly what happens to these rows (keep with the user anonymised, or delete). See the
   purge section below.
4. **`closure_requested_by` is ON DELETE SET NULL**, so it never blocks a purge.

## Own account API (task 2)

5. **Two endpoints beyond the three in the task**: `POST /users/me/email-change/resend` and
   `DELETE /users/me/email-change`. The My account page needs "resend" and "cancel" (task 3), and
   re-sending through the request endpoint would make the person retype their password. Resend
   needs no password (one was given to start the change); it's rate limited the same way.
6. **No notice to the OLD address.** Common practice is to also tell the old address "your email
   is being changed to x". Not asked for and the codebase doesn't do it elsewhere, so not built.
   Worth adding before go-live: it's the only warning a person gets if their session was stolen.
7. **Sessions are signed out by reusing `password_changed_at`.** Old tokens therefore get the
   existing `401 PASSWORD_CHANGED "your password was changed, please log in again"` message after
   an email change too. Slightly wrong wording, but it needs no new column and the mobile apps
   already handle that code. A separate `sessions_revoked_at` column would fix the wording.
8. **Link lifetime 24 hours** (same as the claim verification link); password reset uses 60 min.
9. **`email_verified_at` is left as is** on confirm: opening the link proves the new address, so
   there's nothing to reset.
10. **Spec §2.1 says drivers / parents / school staff have "no self-service edit".** This task
   reverses that on purpose (own name, phone, address, email, password). The admin edit
   (`PATCH /users/:id`, creator only) is unchanged. `TMS_PROJECT_SPEC_1.md` gets a changelog line
   at the end of the branch.

## My account page (task 3)

11. **Which roles show "address".** Driver and parent only: they're the roles whose accounts are
   created with a home address. Monitors have none (MonitorsPage sets it to null), admins and
   school staff are reached through their org. The API itself accepts `address` for any role.
12. **Phones.** "Linked from the sidebar footer next to logout": phones have no sidebar, so the
   driver/parent/monitor phone header got the same icon next to its logout button. The admin
   shell's phone drawer already shows the sidebar footer.
13. **Parent Profile tab** said "to change your details, contact your company". That was no
   longer true, so it now links to My account. The tab itself is unchanged otherwise.

## Usage + billing (task 4)

14. **What counts.** Drivers and monitors: active accounts only (a deactivated one can't sign in).
   Students and vans: every row (neither has a soft delete). Schools: the same rule as
   `GET /schools` for a company (a school one of its students attends, or a placeholder school it
   created). Parents are not counted (not in the list you gave). Say if billing should count
   differently, e.g. only students with an active assignment.
15. **Snapshot covers claimed companies only.** Unclaimed placeholder companies have no users and
   nobody to bill. Closing companies are still snapshotted.
16. **Re-running the same day overwrites that day's row** with the current numbers (idempotent
   in the "one row per company per day" sense). If you'd rather keep the first capture of the day,
   change `DO UPDATE` to `DO NOTHING`.
17. **"Free through the end of the year"** is a fixed label in the client (`PLAN_LABEL`), not a date
   from the DB. `trial_ends_at` stays null; set it if the end date should be real data.

## Legal pages + acceptance (task 5)

18. ~~Does the API service on Render have `client/` on disk?~~ **Resolved in task 7**: the
   documents moved to `server/src/legal/`, the website fetches them from `GET /legal/:document`,
   and the API refuses to start without them. No fallback any more.
19. **No Markdown library.** A ~70-line parser (`client/src/lib/markdown.ts`) handles what the
   placeholder files use (headings, paragraphs, lists, quotes, bold, links) and renders React
   elements, never HTML. If the real legal text needs tables or numbered lists, either extend it
   or add a library such as `marked` (that's a dependency decision for you).
20. **Who else should accept?** Only self-serve signups (company_admin / school_admin) accept now.
   Accounts made by an admin (drivers, monitors, parents, staff), accounts created by approving a
   claim request (`scripts/claim-requests.js`), and every account that existed before this branch
   have no acceptance row. Options: show a one-time "accept to continue" screen at next login for
   anyone without a row for the current versions. Not built.
21. **New versions later.** Bumping `version` in a file makes the server refuse forms still showing
   the old one (409). Existing users are not asked again (see 20).
22. **`server/test/smoke-neon.cjs`** signs up without address / zip / state, so it was already
   failing before this branch; not touched, and not run (it targets Neon).
23. **IP behind Render.** Recorded as `req.ip`, which uses the app's existing `trust proxy 3`
   setting (verified earlier in BACKLOG #9). Locally it's `::1`.

## Closure, request side (task 6)

24. **`/company/account` is a new page** (Settings > "Company account"), holding only the danger
   zone. No such route existed; the company's profile is `/company/profile`, which you asked to
   keep as it is. If you meant the danger zone to sit on the profile page, it's a move of one card.
25. **"Everyone is signed out now" is real, also after an undo.** The request bumps
   `password_changed_at` for every user of the company, so tokens issued before it never work
   again, even if the closure is undone. People sign in again after an undo. (Without this, a
   12-hour token issued before the closure would start working again after an undo.)
26. **Refusal codes.** Login: `403 ACCOUNT_CLOSING` (only after a correct password, so the message
   doesn't reveal to strangers that a company is closing). Any other request: `401 ACCOUNT_CLOSING`
   (the web and mobile clients already drop to login on 401). Message names the purge date and
   says the admin who closed it can use the undo link.
27. **Only the requesting admin gets the undo email.** Other company admins aren't told, and they
   can't undo (they can't sign in). If that email is lost, undo is a manual SQL update today.
   Should all company admins be emailed? Should SafeTurns support have an undo script?
28. **The undo token is in the URL query** (`DELETE /companies/me/closure?token=…`), as the task
   specified. Query strings end up in proxy / access logs (Render, Cloudflare). The token is
   single use and only useful for 30 days, but a POST body would be safer. Your call.
29. **Undo restores `billing_status` to `free`** (see question 2).
30. **What keeps running for a closing company:** the trip auto-complete sweep and its notification
   emails (for trips left open), and nothing tells schools or parents that the company is
   closing. Schools still see the company's students (their own school's students). Should
   schools / parents be notified, and should the sweep skip closing companies?
31. **School closure** isn't covered (the task was company only).

## What the purge would have to do (NOT built, for the retention design)

A job (cron, like the planned snapshot schedule) that, for each company with
`billing_status = 'closing' AND closure_purge_at <= now()`:

1. **Re-checks under a row lock** (`SELECT … FOR UPDATE`) that the company is still closing and
   past its date, so an undo racing the job wins. One transaction per company; a `--dry-run`
   that prints the row counts it would remove; logs counts only, never names or emails.
2. **Deletes or anonymises, in foreign-key order** (child tables first), everything scoped to the
   company: `trips`, `sessions` (driver shifts + GPS), `pickup_skips`, `pickup_no_shows`,
   `schedule_changes`, `assignment_schedule_overrides`, `assignments`, `monitor_assignments`,
   `parent_students`, `staff_student_access` rows for its students, `student_contacts`,
   `student_extra_addresses`, `students`, `pay_adjustments`, `pay_rules`, `vans`,
   `import_mappings`, `password_reset_tokens`, `password_reset_log`, `email_verification_tokens`,
   `usage_snapshots`, `legal_acceptances`, `users`, and finally the `companies` row (or a tombstone).
   The FKs are mixed: some `company_id` / student references are `ON DELETE CASCADE`, others
   aren't (e.g. `legal_acceptances.user_id`). A bare `DELETE FROM companies` would silently cascade
   into some tables and be blocked by others, so the job must delete table by table, on purpose.

Decisions needed first (the retention rules):

- **Shared records with schools.** A student belongs to the company AND a school. Trips carry
  both, `schedule_changes` and `staff_student_access` are written by the school. Deleting the
  company's students removes them from the school's view and history too. Does the school keep
  anything (e.g. trip confirmations), anonymised?
- **Placeholder schools the company created** (`schools.created_by_user_id`): delete if no other
  company has students there and nobody claimed it; keep (and null the creator) otherwise.
  `placeholder_claim_requests.created_user_id` is already `SET NULL`.
- **Payroll records** (`sessions`, `pay_rules`, `pay_adjustments`): employment / tax rules may
  require keeping hours and pay for years. Probably keep anonymised, or offer an export first.
- **Legal acceptances**: keep as proof of consent (anonymised) or delete with the user?
- **Usage snapshots**: billing history, likely keep (they hold no personal data).
- **Backups.** The daily Neon backup workflow keeps artifacts for 90 days, so purged data lives on
  in backups for up to 90 days after the purge. The Privacy Policy should say so.
- **Export before purge.** Offer the admin a download (students, drivers, trips, payroll) during
  the 30 days?
- **Emails already sent** (notifications containing student names) can't be recalled.
- **Audit.** Record that the purge ran (company id, date, counts) somewhere that survives it.

## Legal documents on the server (task 7)

32. **"Fail loudly" = refuse to start.** If `server/src/legal/terms.md` or `privacy.md` is missing
   or its frontmatter has no `version` / `effective`, `src/index.js` logs `[legal] FATAL …` naming
   the file and the problem and exits with code 1 (same idea as `config.js` refusing to boot
   without `JWT_SECRET` in production). On Render that shows as a failed deploy, and the previous
   version keeps serving. If you'd rather the API start and only signup / `GET /legal` fail (503),
   say so; it's a small change.
33. **`markdown` includes the frontmatter block.** You asked for `{ document, version, effective,
   markdown }`; I send the whole file so the text is exactly what's on disk. The website strips the
   frontmatter before rendering. Easy to strip on the server instead.
34. **Mobile apps** don't show the legal pages yet; they can use the same endpoint.

