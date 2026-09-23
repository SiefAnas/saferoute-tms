# Auth for real users (branch `auth-accounts`)

Date: 2026-09-23. Branch from `main`. **Not merged.** Has one migration (021, additive).

## 1. Driver (and parent / staff) first login: temporary password + forced change
**Picked:** the server generates a temporary password when the admin creates the account, shows
it **once** to the admin, and the user must choose their own at first sign-in.

**Why not an invite link:** email isn't configured on Render yet, so an invite would also have to
be copied and handed over by the admin. A temporary password does the same job with less (no
extra page that works without being logged in, no second token type), and the forced change
means the admin never knows the password the user keeps.

How it works:
- `POST /users` (admin): no password in the body (ignored if sent). The response has
  `temporary_password` (e.g. `Kp7x-Qm4r-Tz9w`: 12 random characters without look-alikes like
  0/O/1/l, in 3 groups) and `must_change_password: true`. It is never shown again.
- Drivers need only **name + email** now (phone, address, license optional). Parents keep phone +
  address required (used to match parents to students). Staff: name + email.
- Login returns `user.must_change_password`. Until they change it, the server answers
  `403 PASSWORD_CHANGE_REQUIRED` on every endpoint except `GET /auth/me` and
  `POST /auth/change-password`. Enforced on the server, not just in the apps.
- Applies to every admin-created role (driver, parent, school staff), not only drivers: same
  problem, same fix. Accounts that exist today are unchanged (`must_change_password` false).

## 2. Forgot password (all roles)
- `POST /auth/forgot-password {email}` → always `200 {ok:true}`, also for unknown or inactive
  emails (checked: identical status and body). A known active account gets an email with
  `<website>/reset-password?token=…`.
- Token: 32 random bytes; **only its SHA-256 is stored** (`password_reset_tokens`); single use;
  expires after 60 minutes; asking again cancels older links.
- `POST /auth/reset-password {token, newPassword}` → sets the password and marks the token used.
- **Rate limit:** 5 per 15 minutes per IP, shared by forgot + reset (`RATE_LIMIT_RESET_MAX`).
- Emails go through `sendMailSafe`, so a mail failure never fails the request. Delivery needs the
  Render SMTP vars (not set yet); until then use the admin reset.
- Link address: `APP_URL` env var, else the first `ALLOWED_ORIGINS` entry (the live site today).

## 3. Old sessions end after a password change: yes
New column `users.password_changed_at`. Every change (first-login change, forgot/reset, admin
reset) sets it, and `authenticate` rejects any token issued before it (`401`). Change-password
returns a new token so the user stays signed in on that device. Precision is one second (the
JWT `iat` is in seconds): a token signed in the same second as the change still works. That is
the only gap, and it can't be used to get around a reset.

## 4. Admin reset (when email isn't working)
`POST /users/:id/reset-password` → a new temporary password, returned once; the old password
and every session of that user stop working; they must choose a new one at next sign-in. The
admin never sees the old password. Same rules as editing: only the admin who created the
account (old accounts with no creator: any admin in the same tenant, as before), only roles
this admin can create, not themselves, not another admin; another tenant's user → `404`.
`PATCH /users/:id` no longer accepts `password` (`400`), so there is one way to do it.

## 5. Web
- **Login:** "Forgot password?" goes to the real flow (the old static "contact your admin" panel
  is gone). An account on a temporary password is sent to **Choose your password**.
- **/set-password** (temporary password, new, confirm), **/forgot-password**,
  **/reset-password?token=**. Same card as the login page.
- **Add driver / parent / staff:** no password field. After saving, a dialog shows the temporary
  password once with a Copy button ("shown only now").
- **Edit account:** the "New password" field is replaced by a Password row ("Hasn't set their own
  password yet" / "Set by them") with **Reset password** → confirm → new temporary password.
- **CSV import** (drivers, parents): new rows get a temporary password, shown in that row's
  import result; a Password column is ignored. The CSV template no longer has one.
- A `403 PASSWORD_CHANGE_REQUIRED` in the middle of a session sends the user to set-password.

## 6. Mobile (small enough, done)
- After sign-in (or app start with a stored session), an account on a temporary password goes to
  **Choose your password**; the new token replaces the stored session.
- **Forgot password?** opens a screen that requests the reset email; the link opens the website.
- `npm run typecheck`, `npm run lint`, jest 53/53 pass. Not tried on a phone.

## 7. Tests
- **Suite 20** (`server/test/20-auth-accounts.test.cjs`), 49 checks: temporary password shown
  once and not stored in reads; body password ignored; first login blocked everywhere except
  me/change-password; wrong current / weak / same password refused; old session 401 after the
  change; forgot password same answer for known / unknown / inactive email; only a hash stored;
  wrong token, weak password, token reuse (single use), expired token, older link after a newer
  one all refused; sessions end after reset; admin reset (creator only; same-company other
  admin 403; other company 404; school admin 404; self 403; another admin 403); a driver can't
  reset another driver (403, and not through PATCH either); rate limit (429).
- Suites 01, 04, 09 and `e2e-roles.mjs` updated to the new flow (accounts made via the API
  activate with their temporary password). Full server suite: 20/20 pass.
- `e2e-roles.mjs` against a throwaway local API on an embedded database: 75/75.
- Client `npm test`, `tsc -b`, `vite build` pass.
- Checked in the browser against that local API (not Neon): add driver → temp password dialog;
  Edit → Reset password → confirm → new temp password; a driver on a temp password opening
  `/driver` lands on Choose your password; forgot password → same confirmation → the (logged,
  not sent) email has the right link → reset page opens; reset page without a token shows an
  error. I didn't type passwords into the browser; the change/reset steps are covered by suite 20.

## Not sure / for you
1. **Migration on merge:** 021 must be applied to Neon (`npm run migrate:up`) with the deploy.
   Old code ignores the new columns, so applying it before deploying is safe. I did not apply it
   (branch not approved).
2. **Existing live accounts** keep their current passwords and are not forced to change. Say if
   you want all drivers to set new passwords (one SQL update).
3. **School staff and parents** also get temporary passwords (not only drivers). Same problem;
   it seemed wrong to leave admins typing permanent passwords for two roles.
4. **Mobile + reset mid-session:** the app doesn't react to a 403 PASSWORD_CHANGE_REQUIRED in the
   middle of a session, but an admin reset also ends the session (401), so the user signs in
   again and gets Choose your password.
5. **Branches overlap in `PENDING.md`** (this branch and `web-desktop-layout` both edit it):
   expect a small conflict there when merging the second one.
