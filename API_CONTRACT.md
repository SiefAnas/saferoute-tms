# SafeRoute TMS: API contract (for the mobile apps)

Written from the code on branch `mvp-finish` (`server/src/routes/*`, `server/src/services/*`,
`client/src/types/api.ts`). If this document and the code disagree, the code wins: fix this file.

- **Driver** and **Parent** endpoints are documented in full (the mobile apps need them).
- **Company admin / school admin / school staff** are listed with less detail at the end.
- **Who can see which students**: section 0 below (branch `access-scope`). Enforced on the
  server; the app must follow it too (only ask for what the role can see).

---

## 0. Access rules (who sees which students)

The most important rule in the app: children's names and home addresses. Every role sees only
the students it is assigned to. **Enforced on the server**, never only in the UI.

| Role | Can see students |
|---|---|
| `company_admin` | only students of their own company |
| `school_admin` | only students of their own school (from any company) |
| `school_staff` | only students granted to them (`staff_student_access`) |
| `parent` | only their own linked children, only through `/parent/*` |
| `driver` | only students on the driver's **own** assignments (morning or afternoon) that are **active today or start in the future**. Not ended assignments, not other drivers' students |

"See" means everything: lists, get by id, and student data inside other responses (trips,
schedule, assignments, vans, schools, dashboard). **A student (or van, school, assignment,
trip) outside the caller's scope returns `404`, not `403`**, so the app can't tell whether the
id exists. `403` means the role may not call that endpoint at all.

**Driver writes** follow the same rule, stricter: logging a trip (`POST /trips`) or reporting a
no-show needs the student's assignment to run **today** and cover that shift.
Not the driver's student (or an ended assignment) → `404`; the driver's student but not on
today's run for that shift (starts later, or the other shift) → `409`.

### Which endpoints each role can call

| Endpoint | company_admin | school_admin | school_staff | driver | parent |
|---|---|---|---|---|---|
| `GET /students`, `GET /students/:id` | company | school | granted | own not-ended assignments | 403 |
| `POST/PATCH/DELETE /students…` | ✓ | 403 | 403 | 403 | 403 |
| `GET /vans`, `GET /vans/:id` | company | 403 | 403 | vans on own not-ended assignments | 403 |
| `GET /schools/:id` | schools the company has students at | 403 | 403 | schools of own not-ended assignments' students | 403 |
| `GET /schools`, `GET /schools/me` | list / 403 | 403 / own | 403 / own | 403 | 403 |
| `GET /assignments`, `GET /assignments/:id` | company | 403 | 403 | own, not ended | 403 |
| `GET /schedule/today`, `POST /schedule/:id/no-show` | 403 | 403 | 403 | own, today | 403 |
| `GET /sessions`, `POST /sessions/checkin…` | read company | 403 | 403 | own | 403 |
| `GET /trips`, `GET /trips/:id` | company | school | granted | trips on own shifts | 403 |
| `POST /trips` | 403 | 403 | 403 | own students on today's run | 403 |
| `POST /trips/:id/confirm` | 403 | school | granted | 403 | 403 |
| `GET /dashboard/absent-today` | company | school | granted | 403 | 403 |
| `GET/POST /schedule-changes…` | 403 | school | granted | 403 | 403 |
| `GET /payroll/summary/:driverId`, `/payroll/adjustments/:driverId` | company | 403 | 403 | own id | 403 |
| `/parent/*` | 403 | 403 | 403 | 403 | own linked children |

"Trips on own shifts" is the driver's own work history: it can include a trip for a student
whose assignment has since ended. The trip row only has the `student_id`; the student record
itself (`GET /students/:id`) is then `404`.

---

## 1. Basics

| | |
|---|---|
| Production base URL | `https://saferoute-tms-api.onrender.com` (no `/api` prefix; the web client adds `/api` only for its local Vite proxy) |
| Local dev | `http://localhost:4000` |
| Format | JSON in and out. Send `Content-Type: application/json` on requests with a body. |
| Auth | `Authorization: Bearer <token>` on every endpoint except `/health`, `/auth/login`, `/auth/verify-email`, `/auth/resend-verification`, `/signup/*` |
| Health check | `GET /health` → `200 {"status":"ok"}` |

### Errors
Every error is JSON with one field:
```json
{ "error": "human readable message" }
```
| Status | Meaning |
|---|---|
| 400 | Validation failed (missing/invalid field, bad id format, "nothing to update") |
| 401 | Missing/invalid/expired token, wrong login, or account deactivated → send the user to login |
| 403 | Your role may not do this (`"forbidden"`), or the org isn't operable yet (`"account pending email verification"`), or a business rule (`"too late to skip today's pickup"`) |
| 404 | Not found **or not in your scope**: another company's/school's rows always look like 404, never 403 |
| 409 | Conflict: duplicate, already done, or needs confirmation (see check-in) |
| 429 | Rate limited (login: 20 attempts / 15 min per IP) |
| 500 | `{"error":"internal server error"}` |

Show `error` to the user as-is for 400/403/409; the messages are written for people.

### IDs, dates and times: read this
- All ids are UUID strings.
- **A "day" is always a calendar date string `YYYY-MM-DD`.** Never derive one with
  `toISOString().slice(0,10)` (that's UTC and gives the wrong day in the evening in the US and
  after midnight in Egypt). Use the device's local calendar date where the app needs "today" for
  display, and send dates as `YYYY-MM-DD`.
- **"Today" for the business rules comes from the server database** (`CURRENT_DATE` in
  Postgres): `/schedule/today`, skip eligibility, no-shows, "already worked this shift today",
  `/dashboard/absent-today`. The app must not compute these itself. Note: the production DB
  timezone is currently `GMT` (open decision in `PENDING.md`), so the server's day flips at
  midnight UTC (about 8pm in Boston).
- Postgres `DATE` columns come back as `"2026-09-22T00:00:00.000Z"`: **take the first 10
  characters** as the date. Do not parse them with a timezone (that shifts the day west of UTC).
- Timestamps (`created_at`, `check_in_at`, ...) are ISO 8601 UTC instants: convert to local time
  for display.
- Times of day (`pickup_time`, `dropoff_time`) come back as `"HH:MM:SS"` and are sent as
  `"HH:MM"` (24h).
- Money is always integer **cents** (`rate_cents`, `total_pay_cents`).

---

## 2. Auth

### `POST /auth/login` (public)
Request:
```json
{ "email": "driver@company.com", "password": "Secret123!" }
```
Response `200`:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "83acb1ae-…", "email": "driver@company.com", "full_name": "Luis Ortega",
    "role": "driver", "tenantType": "company", "tenantId": "3f1c…"
  }
}
```
- `role`: `driver | parent | company_admin | school_admin | school_staff`.
  `tenantType`: `company` (driver, parent, company_admin) or `school`.
- Errors: `400` missing fields, `401 {"error":"invalid credentials"}` (wrong email/password or
  deactivated), `429` rate limited.
- Email match is case-insensitive.

### Token
- JWT (HS256), expires after **12 hours** by default (`JWT_EXPIRES_IN` on the server).
- **No refresh token.** When any call returns `401`, clear the token and show login.
- The server re-reads the user on every request, so deactivating an account or changing its
  role takes effect immediately (next call returns 401/403).
- Web client stores it in `localStorage` (`saferoute_token`, `saferoute_user`). Mobile: use
  the platform's secure storage (Keychain / EncryptedSharedPreferences).

### `GET /auth/me`
Response `200`: `{ "user": { "userId", "role", "tenantType", "tenantId", "orgClaimStatus", "emailVerifiedAt" } }`
(note: different shape from login's `user`).

### Logout
Client-side only: delete the stored token. There is no server logout / revocation endpoint.

### Password reset
**Does not exist.** Drivers, parents and school staff get their password from the admin who
created their account; only that admin can change it (`PATCH /users/:id`). The web login shows
a static "contact your administrator" message. See `V2_ROADMAP.md`.

### How accounts are created
- Company admins and school admins sign up themselves (`POST /signup/company|school`).
- **Drivers and parents are created by a company admin** (`POST /users`), who sets the real,
  permanent password. There is no driver/parent self-registration and no forced first-login
  password change.
- School staff are created by their school admin.

---

## 3. Driver endpoints

Driver = `role: "driver"`. Every driver call is scoped to the driver's company; rows noted
"own" are further limited to the driver's own records.

### `GET /schedule/today` (driver only)
Today's active assignments for this driver, with today's one-off override (if any), parent
skips and reported no-shows. Ordered by student name.
```json
[
  {
    "assignment_id": "c2a0…",
    "shift_period": "both",
    "pickup_time": "07:10:00",
    "dropoff_time": "15:20:00",
    "student": { "id": "7e43…", "name": "Maya Robinson", "grade": "3", "parent_name": "Nina Robinson", "parent_phone": "555-0101" },
    "school": { "id": "bf22…", "name": "Lincoln Elementary" },
    "override": { "pickup_time": "07:50:00", "dropoff_time": null, "skip": false, "note": "Late start" },
    "parent_skipped": { "morning": false, "afternoon": false },
    "no_show_reported": { "morning": false, "afternoon": false }
  }
]
```
- `shift_period`: `morning | afternoon | both`. A student belongs to a shift's list if
  `shift_period` is that shift or `both`.
- `override` is `null` when there's no change today. Effective time = `override.pickup_time ?? pickup_time`.
  `override.skip: true` = no ride today.

### `GET /sessions` (driver: own shifts)
All of the driver's shifts (not only today), each:
```json
{ "id": "0d9e…", "user_id": "83ac…", "company_id": "…", "shift_period": "morning",
  "check_in_at": "2026-09-23T14:00:07.551Z", "check_out_at": null,
  "check_in_lat": "39.78", "check_in_lng": "-89.65", "check_out_lat": null, "check_out_lng": null,
  "duration_minutes": null, "trip_count": 1, "created_at": "…", "updated_at": "…" }
```
- The open shift is the one with `check_out_at: null` (at most one).
- `shift_period` can be `null` on very old sessions (before the morning/afternoon split).
- `GET /sessions/:id` returns one (404 if not yours).

### `POST /sessions/checkin` (driver only)
```json
{ "shift_period": "morning", "check_in_lat": 39.78, "check_in_lng": -89.65, "confirm_switch": true }
```
- `shift_period` required: `morning | afternoon`. GPS optional (both numbers or neither).
  `confirm_switch` optional.
- `201` → the new session.
- `409` cases (show the message, and handle the first one with a confirm dialog):
  - `"you are currently checked into Morning; confirm to switch to Afternoon"`: another shift
    is open. Ask the driver, then resend with `"confirm_switch": true`; the server checks out
    the open shift and checks into the new one.
  - `"you are already checked into Morning"`
  - `"you already worked the Morning shift today and cannot return to it"`
- `400` invalid shift or GPS. `403` not a driver.

### `POST /sessions/:id/checkout` (driver only, own session)
Body optional: `{ "check_out_lat": 39.78, "check_out_lng": -89.65 }`. `200` → the updated
session (with `check_out_at`, `duration_minutes`). `404` not yours, `409` already checked out.

### `POST /trips` (driver only)
Log a pickup or drop-off for a student on the currently open shift.
```json
{ "student_id": "7e43…", "trip_type": "pickup", "shift_period": "morning" }
```
- The web app uses `pickup` for morning stops and `dropoff` for afternoon stops.
- `201` → the trip, `status: "pending"` until the school confirms (or 5 minutes pass: the
  server auto-completes it).
- `409 "check in for that shift before logging a trip"`, `404` student not on one of your
  (not-ended) assignments, `409 "this student is not on your morning run today"` (assignment
  starts later or covers the other shift only), `400`.

### `GET /trips` (driver: trips on own shifts)
All of the driver's trips (not only today; filter by local date of `created_at`):
```json
{ "id": "5631…", "session_id": "0d9e…", "company_id": "…", "school_id": "…", "student_id": "7e43…",
  "trip_type": "pickup", "shift_period": "morning", "driver_confirmed_at": "…", "staff_confirmed_at": null,
  "status": "pending", "auto_completed": false, "completed_at": null,
  "created_at": "…", "updated_at": "…", "driver_name": "Luis Ortega", "driver_phone": "555-0100" }
```
`status`: `pending | complete`. `GET /trips/:id` for one.

### `POST /schedule/:assignmentId/no-show` (driver only)
"Arrived, nobody came out." Body `{ "shift_period": "morning" }`. `200 {"reported": true}`.
Notifies the school and company admins. Errors: `409 "check in for that shift before reporting a no-show"`,
`409` already reported for this shift today, `409 "this assignment is not on your … run today"`
(starts later / other shift), `404` not your assignment or it has ended.
The response also has `notified`: the emails that were actually sent. A failed email never
fails the request (the no-show is saved either way).

### `GET /students/:id` (driver: own students only)
Full student record plus extra contacts:
```json
{ "id": "7e43…", "company_id": "…", "school_id": "…", "full_name": "Maya Robinson", "grade": "3", "age": 8,
  "parent_name": "Nina Robinson", "parent_phone": "555-0101",
  "street_address": "1422 Oak St", "city": "Springfield", "state": "IL", "zip_code": "62704",
  "notes": "Allergic to peanuts.", "created_at": "…", "updated_at": "…",
  "contacts": [ { "id": "…", "name": "Ruth Brooks", "phone": "555-0102", "relationship": "Grandmother", "student_id": "7e43…", "company_id": "…", "school_id": "…", "created_at": "…" } ] }
```
A driver can read only students on their own assignments that are active today or start
later (section 0). Anyone else → `404`. `GET /students` (list) returns the same set.

### `GET /schools/:id` (driver, company admin)
Company admin: schools the company has a student at. Driver: only schools of students on the
driver's own not-ended assignments. `404` otherwise.
```json
{ "id": "…", "name": "Lincoln Elementary", "address": "200 School St", "zip_code": "62704", "state": "IL",
  "phone": "555-300-1200", "hours": "8:00 AM – 3:00 PM", "website": null }
```

### `GET /vans` / `GET /vans/:id` (company admin: fleet; driver: own vans only)
Driver: only vans on the driver's own not-ended assignments; any other van → `404`.
```json
{ "id": "78a2…", "company_id": "…", "number": "04", "license_plate": "KX-4471", "brand": "Ford", "model": "Transit",
  "year": 2021, "color": "White", "created_at": "…", "updated_at": "…" }
```
`number` is optional (`null`); show "Van 04" when set, else brand + model.

### `GET /assignments` (driver: own, not ended)
The driver's assignments that are active today or start later (ended ones are left out, and
`GET /assignments/:id` of an ended one is `404`). Used to find today's van: the active one
(`start_date <= today` and `end_date` null or `>= today`, comparing `YYYY-MM-DD` strings) → `van_id`.
```json
{ "id": "c2a0…", "company_id": "…", "student_id": "7e43…", "driver_user_id": "83ac…", "van_id": "78a2…",
  "start_date": "2026-09-23T00:00:00.000Z", "end_date": null, "shift_period": "both",
  "pickup_time": "07:10:00", "dropoff_time": "15:20:00", "created_at": "…", "updated_at": "…" }
```

### `GET /payroll/summary/:driverId?from=YYYY-MM-DD&to=YYYY-MM-DD` (driver: own id only)
Pay for a range (`to` exclusive). The web app sends the 1st of this month and the 1st of next month.
```json
{ "driver_id": "83ac…", "rate_type": "hourly", "rate_cents": 2200, "worked_minutes": 5025, "worked_days": 14,
  "base_pay_cents": 184250, "adjustments_cents": 0, "total_pay_cents": 184250 }
```
`404 "no pay rule for this driver"` = no rate set yet (show "no pay rate yet"). `403` for
another driver's id. `GET /payroll/adjustments/:driverId` (own id) lists pay adjustments.

---

## 4. Parent endpoints

Parent = `role: "parent"`. **Parents may only call `/parent/*` and `/auth/*`.** `/students`,
`/trips`, `/sessions`, `/assignments`, `/vans` return `403` for parents (by design).
Every `/parent/students/:id/*` call returns `404 "student not found, or not linked to your account"`
for a child not linked to this parent.

### `GET /parent/me`
```json
{ "full_name": "James Brooks", "email": "james@example.com", "phone": "555-0199", "address": "902 Maple Dr" }
```

### `GET /parent/students`
The parent's linked children (same fields as the student record in §3, without `contacts`).

### `GET /parent/students/:id/detail`
```json
{
  "student": { "id": "7e43…", "full_name": "Ava Martinez", "grade": "2" },
  "school": { "name": "Lincoln Elementary" },
  "company": { "name": "3 Bees Transportation", "phone": "555-100-2000" },
  "transport": [
    { "shift_period": "both",
      "van": { "number": "04", "license_plate": "KX-4471", "brand": "Ford", "model": "Transit", "year": 2021, "color": "White" },
      "driver": { "full_name": "Luis Ortega", "phone": "555-0100" },
      "pickup_time": "07:26:00", "dropoff_time": "15:28:00" }
  ],
  "skip_today": false,
  "trips_today": [
    { "trip_type": "pickup", "status": "complete", "driver_confirmed_at": "…", "staff_confirmed_at": "…", "completed_at": "…", "created_at": "…" }
  ]
}
```
- `transport` has one entry per active assignment (two when morning and afternoon differ).
  Times include today's override.
- Status to show: `skip_today` → skipped; a `dropoff` trip → dropped off; a `pickup` trip with
  `status: complete` → arrived at school; `pending` → dropped at school, waiting for the school.

### `GET /parent/students/:id/skip-status`
Whether "Skip today's pickup" is allowed right now (server decides, based on the DB's today
and the cutoff before pickup time). Two shapes:
```json
{ "splitShift": false, "eligible": true, "reason": null, "pickupTime": "07:26:00", "alreadySkipped": false }
```
`reason` when not eligible: `"already skipped today"`, `"pickup already marked skipped today"`,
`"too close to or past pickup time"`, `"no scheduled pickup today"`.
```json
{ "splitShift": true,
  "morningOnly": { "eligible": true, "alreadySkipped": false },
  "wholeDay": { "eligible": true, "alreadySkipped": false },
  "pickupTime": "07:26:00" }
```
(split = separate morning and afternoon assignments).

### `POST /parent/students/:id/skip-pickup`
- Non-split child: no body. Split child: `{ "shift_choice": "morning" }` or `{ "shift_choice": "whole_day" }`
  (whole day also cancels the afternoon ride).
- `200 { "skipped": true, "skips": [...], "notified": ["…emails…"] }`. Notifies the driver(s),
  the school and the company admins. `notified` lists only emails actually sent; a failed email
  never fails the request (the skip is saved either way).
- Errors: `400` no pickup today / missing `shift_choice` for a split child, `403` too late,
  `409` already skipped.

---

## 5. Other roles (lighter detail)

All scoped to the caller's own company or school; another tenant's ids return 404.

**Company admin** (`company_admin`)
| Method + path | Notes |
|---|---|
| `GET/PATCH /companies/me` | PATCH: `name, address, zip_code, state, phone, email, city` (email/city optional, blank clears) |
| `GET /users?role=driver\|parent` · `POST /users` · `GET/PATCH /users/:id` | POST body `{ role: 'driver'\|'parent', fullName, email, password, phone, address, licenseNumber (driver) }`. PATCH only by the admin who created the account. |
| `GET/POST /vans`, `GET/PATCH/DELETE /vans/:id` | POST requires `license_plate, brand, model, year, color`; optional `number` (≤10 chars, unique in the company → 409) |
| `GET/POST /students`, `GET/PATCH/DELETE /students/:id`, `POST/DELETE /students/:id/contacts[/:contactId]` | |
| `GET /schools` | id + name of schools the company works with (incl. own placeholders) |
| `POST /placeholders/school` | `{ name, address }`: add a school that hasn't signed up |
| `GET/POST /assignments`, `GET/PATCH/DELETE /assignments/:id`, `GET/POST /assignments/:id/overrides`, `DELETE /assignments/:id/overrides/:overrideId` | times `HH:MM`, dates `YYYY-MM-DD` |
| `GET/POST/DELETE /parent-access` | link a parent to a student |
| `GET /sessions`, `GET /trips` | whole company |
| `GET /payroll/rules`, `PUT /payroll/rules/:driverId`, `POST /payroll/adjustments`, `GET /payroll/unpaid-summary/:driverId`, `POST /payroll/rules/:driverId/mark-paid`, `GET /payroll/summary/company` | |
| `GET /dashboard/absent-today` | today's parent skips + driver no-shows |

**School admin** (`school_admin`) / **school staff** (`school_staff`)
| Method + path | Notes |
|---|---|
| `GET /schools/me` (both), `PATCH /schools/me` (admin) | |
| `GET /students` | admin: whole school; staff: only granted students. Each row has `transport[]` (company, van incl. `number`, driver name/phone). |
| `GET /trips`, `POST /trips/:id/confirm` | confirm = "received"; `409` if already complete |
| `GET /dashboard/absent-today` | own school |
| `GET /schedule-changes`, `POST /schedule-changes/students/:id` | `{ change_type: 'left_early'\|'staying_later', note? }`; cancels today's pickup and notifies |
| `GET /users?role=school_staff`, `POST /users` (admin) | create staff `{ role: 'school_staff', fullName, email, password }` |
| `GET/POST/DELETE /staff-access` (admin) | grant staff access to a student |
| `POST /placeholders/company` (admin) | add a company that hasn't signed up |

**Public**: `POST /signup/company|school` (`{ orgName, address, zip, state, fullName, email, password }`),
`GET /signup/:kind/claimable`, `POST /auth/verify-email`, `POST /auth/resend-verification`.

---

## 6. CORS and networking notes for mobile
- CORS only applies to browsers. Native iOS/Android HTTP clients don't send an `Origin`
  header, so `ALLOWED_ORIGINS` on the server doesn't affect them. No change needed for the app.
- If the app ever embeds a web view that calls the API, its origin must be added to
  `ALLOWED_ORIGINS` on the Render API service.
- Rate limits are per client IP (the server trusts 3 proxy hops for Render + Cloudflare):
  login 20 / 15 min, signup 20 / hour.
- The API may take a while to answer the first request after a quiet period if the Render plan
  spins services down. Show a loading state rather than failing fast.

## 7. What the mobile app must NOT do
- Don't call endpoints that don't exist yet (all V2, see `V2_ROADMAP.md`): no `/schedule/week`,
  no live location / ETA / map endpoints, no payment history, no password reset, no push
  registration, no `PATCH /me` self-edit. Show "Coming soon" for those, like the web app.
- Don't compute "today" from UTC, and don't decide skip eligibility, "already worked this shift"
  or no-show rules client-side: call the endpoint and show its answer/error.
- Don't cache another user's data after logout; clear everything on 401.
- Don't call `/students`, `/trips`, `/sessions`, `/assignments` or `/vans` from the parent app
  (they return 403 for parents).
- Don't rely on `GET /trips` or `GET /sessions` being only today: filter by the local date of
  `created_at` / `check_in_at`.
