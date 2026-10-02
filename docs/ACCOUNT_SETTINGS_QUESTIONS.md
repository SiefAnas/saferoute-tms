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

