# Mobile app: what the backend still needs

Things the mobile app needs from the server that don't exist or don't work yet. The app shows
"Coming soon" (or handles the problem) until then. Nothing here was changed on the server by
the mobile work.

## Bugs found while testing against the live API (2026-09-23)

### 1. No-show and skip-pickup answer 500 after saving (FIXED, live 2026-09-23)
- **Fixed on `main`** (from branch `access-scope`): an email failure never fails a request
  any more; both endpoints answer 200 and `notified` lists only emails actually sent. Test
  suite 18. The app's reload-after-any-outcome handling can stay as a safety net.
- `POST /schedule/:assignmentId/no-show` (driver) and `POST /parent/students/:id/skip-pickup`
  (parent) both returned `500 {"error":"internal server error"}` on the live API.
- **The action WAS saved:** the second call returns 409 ("already reported" / "already skipped")
  and `/schedule/today` shows `no_show_reported: true`.
- Likely cause: both write the row first, then send notification emails
  (`services/notifications.js` → `mail/mailer.js`). If SMTP is set on Render and a send fails
  (for example the `@example.test` test recipients), the error bubbles up as a 500.
- **Fix (server):** don't fail the request when a notification email fails. Send after the
  write, catch and log errors per recipient (for example `Promise.allSettled`), and return
  success with the list that was actually notified.
- **What the app does meanwhile:** after any outcome it reloads the schedule / skip status,
  so the screen shows what was really saved. The message for a 5xx says "check whether it
  went through before trying again".

## Features the app shows as "Coming soon" (V2, see `V2_ROADMAP.md`)
| App place | Backend needed |
|---|---|
| ~~Driver: Week tab~~ | **Done** (branch `v2-week-ui`): the tab calls `GET /schedule/week?start=YYYY-MM-DD` (Monday) and shows the real week. |
| Driver: Pay → "Paid in {month}" | Payment history ledger + `GET /payroll/payments?from&to` (own driver) |
| Parent: live location and ETA / "van is X stops away" | Route order per driver + current stop; live location pings + ETA service |
| ~~Login: forgot password~~ | **Done** (branch `auth-accounts`): the app's "Forgot password?" screen calls `POST /auth/forgot-password`; the emailed link opens the website to set the new password. First-login "Choose your password" screen too. Email delivery needs the Render SMTP vars. |
| Push notifications (not in the app at all yet) | Device token table + FCM/APNs sender |

## Nice to have for the app
- **`GET /auth/me` with the login `user` shape** (`id, email, full_name, role, tenantType,
  tenantId`). Today it returns a different shape, so the app keeps the user from login in secure
  storage.
- **Driver access scope (live on `main`, checked 2026-09-23: every call below answers 200 for
  the driver's own data):** the app only calls `/schedule/today`,
  `/sessions`, `/trips`, `/assignments` (own), `/students/:id` and `/schools/:id` for students on
  today's schedule, and `/vans/:id` for the driver's own van. Keep those working for the driver's
  own data when the scope is narrowed.
