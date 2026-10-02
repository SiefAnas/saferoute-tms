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

