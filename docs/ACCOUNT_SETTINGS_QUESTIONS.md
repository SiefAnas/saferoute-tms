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

