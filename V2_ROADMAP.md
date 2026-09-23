# V2 roadmap

Everything here is **not in the MVP**. Where a feature has a place in the UI, the button or card
is kept and opens the shared **Coming Soon** dialog (`client/src/components/ComingSoon.tsx`),
so nothing silently does nothing and no fake data is shown.

Size: **S** = about a day, **M** = a few days, **L** = a week or more / needs a third party.

## Shown as Coming Soon in the app today

| Feature | What the user sees now | Backend needed | Size |
|---|---|---|---|
| **Driver week schedule** | **Done** (UI on branch `v2-week-ui`): web and mobile Week tabs show Monday–Sunday with each day's morning pickups and afternoon drop-offs (time changes, notes, parent skips, no-shows, no-ride days) and previous / next week. | Backend live on `main`: `GET /schedule/week?start=YYYY-MM-DD`. Later: a weekday pattern (see "Recurring weekly schedule") so weekends don't show. | Done |
| **Live map** (company dashboard) | "Live fleet" card shows a Coming Soon card instead of a map. | Pick a map provider (Mapbox / Google Maps: API key in env, billing). Location source: today only check-in/out GPS is stored on `sessions`. For a real live map: `driver_locations` table (driver_id, lat, lng, recorded_at), `POST /locations` from the driver app every N seconds while checked in, a retention/cleanup job, `GET /fleet/locations` for admins. | L |
| **Parent live ETA / "Van is X stops away"** | Child card has a "Live location and ETA" row that opens Coming Soon. The status banner shows only real states (skipped, arrived at school, dropped off, next pickup time). | Route order per driver/shift (`assignments.stop_order` or a `routes` table), a "current stop" pointer updated as trips are logged, then expose `stops_away` / `eta` on `GET /parent/students/:id/detail`. Real ETA also needs live location (above) + a routing/ETA API. | M (stops away) / L (ETA) |
| **Payment history / "Paid in {month}"** (payroll) | Stat card shows "Coming soon" and opens the dialog. Owed amounts and Mark paid work for real. | `pay_payments` ledger (driver_id, company_id, amount_cents, paid_at, cycle_from, cycle_to, paid_by_user_id) written inside `POST /payroll/rules/:id/mark-paid`, plus `GET /payroll/payments?from&to`. | S |
| **On time / Late driver status** (dashboard) | "On time" / "Late" filter chips open Coming Soon. "On shift / Not in" is the real status. | Planned stop times in route order + a lateness rule (e.g. first trip logged > N min after planned time), computed server-side into a dashboard endpoint. Depends on route order (above). | M |
| **Dashboard summary endpoint** | (Not visible) Dashboard adds up 9 list endpoints in the browser. | `GET /dashboard/summary?run=morning\|afternoon` returning the stat-row numbers. Needed before fleets get large. | S |

## From BACKLOG.md / spec §8 (not in the UI yet)

| Feature | What the user sees now | Backend needed | Size |
|---|---|---|---|
| **Forgot password / password reset** | Login shows a "Forgot password?" panel that tells drivers/parents/staff to contact their admin (static message, no reset). | `password_reset_tokens` table (hashed token, expiry), `POST /auth/forgot-password`, `POST /auth/reset-password`, email via the existing mailer (needs Render SMTP vars). | M |
| **Self-service profile edit** (parent/driver/staff) | Parent Profile tab is read-only with "contact your company". | `PATCH /me` for own phone/address/password (with current-password check). Today only the creating admin can edit via `PATCH /users/:id`. | S |
| **Parent form edit for multiple guardians** | Add Student supports several guardians; Edit Student edits only the primary one (others via the Contacts panel). | None (frontend), or a batch `PUT /students/:id/contacts`. | S |
| **CSV import updates students** | Student CSV import is add-only (no reliable natural key). | A stable student key (e.g. `external_id` / school student number) + upsert by it. | S |
| **Alerts beyond the 10-hour flag** | Dashboard "Needs attention" flags shifts open > 10h, no-shows, waiting trips, not-checked-in drivers, missing rates. No push/email alerts. | Notification system: `notifications` table, background job (e.g. forgot checkout, trip not confirmed by school, late driver), delivery via email / push (FCM/APNs) / SMS. Replace the silent 5-minute trip auto-complete with a reminder + admin alert (TODO in `server/src/services/trips.js`). | L |
| **SMS / phone login** | Email + password only. | SMS provider (Twilio etc.), `POST /auth/otp/request` + `/auth/otp/verify`, phone uniqueness on users, rate limiting. | M |
| **Push notifications (mobile)** | None. | Device token table, FCM/APNs keys, sender in the notification job. | M |
| **Auto check-out / forgotten check-out** | A forgotten check-out stays open (dashboard flags it after 10h). | Background job to close or flag stale sessions + notify. | S |
| **Recurring weekly schedule** (e.g. "no pickups on Fridays") | Only single-day overrides. | `assignment_recurring_rules` table and applying it in `/schedule/today` and `/schedule/week`. | M |
| **Pay rate history** | Only the current rate is kept. | `pay_rules` history table (effective_from) and summary math over ranges. | M |
| **Postgres Row-Level Security** | (Not visible) Tenant scoping is enforced by composite FKs + the scoped accessor. | RLS policies on every table + per-request session variable. | L |
| **Reporting, billing, per-tenant branding, photo uploads, van maintenance, route optimization** | Not in the app. | Spec §8: explicitly after MVP. | L each |
| **Claim flow on /register** | Hidden (`CLAIM_FLOW_ENABLED = false`); backend exists. | None: product decision to turn it back on. | S |
