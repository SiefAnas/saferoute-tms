# MVP finish report: branch `mvp-finish`

**Status: done. Anas approved; `mvp-finish` merged to `main` (`4ee1cd0`) on 2026-09-23 and deployed.**

Live checks after deploy: API `/health` ok; the parent fix is live (test parent gets 403 on
`GET /students`); live `GET /vans` returns `number`, a duplicate number returns 409;
`/companies/me` returns email/city; the live site shows "Van 04" on Fleet, email/city on
Company profile and the Coming Soon map card; no console errors.
Worked only in `C:\Users\anas2\saferoute-tms`. No force push, no history rewrite. `main` untouched.

## Summary
- Design branch merged cleanly; all 6 design decisions applied.
- Real backend features: **van number** and **company email + city** (additive migration 20,
  already applied to Neon), with UI and a new test suite.
- Shared **Coming Soon** dialog/card. It's wired to the live map, parent live ETA, the driver Week
  tab, "Paid in {month}", and On time / Late. No fake data anywhere.
- **Security bug found and fixed:** a parent's token could list every student in the company
  (other families' children, home addresses, guardian phones, notes), plus all trips and
  drivers' check-in GPS. Fixed with a role guard and a regression suite.
- Dead-button audit across all 5 roles found no dead buttons and no console or server errors.
  All role flows were checked end to end against the real API + Neon (38/38).
- New docs: `V2_ROADMAP.md`, `API_CONTRACT.md`, updated `PENDING.md`, doc links in `README.md`.

## Tests (final run)
| Check | Result |
|---|---|
| Server `npm test` | **16/16 suites pass** (incl. new 15: 29 checks, 16: 21 checks) |
| Client `npm test` | payrollCycle 5/5, localDate 27/27 |
| `tsc -b` | clean |
| `vite build` | clean (main chunk ~283 kB, no size warning) |
| End-to-end against local API + Neon (`server/scripts/e2e-roles.mjs`) | 38 passed, 0 failed |
| UI walk-through, all 5 roles, local client + API + Neon | every page, drawer, modal and V2 button checked; 0 console errors, 0 server errors |

---

## Step by step

### 1. Merge the design branch
`main` (`55e5ee2`) → `mvp-finish`, merged `origin/design-refresh`: no conflicts (`84f8fcb`).
After the merge: server 14/14 suites, client tests, `tsc -b` and `vite build` all green.

### 2. Design decisions (`4d047d9`)
1. Trip type by shift (morning = pickup, afternoon = drop-off): already in the design branch.
2. "Check out of shift early" kept. It now asks first ("n students are not handled yet… you
   can't come back to this shift today"), with Stay checked in / Check out.
3. Logout buttons kept.
4. Driver Week tab stays in the tab bar and opens Coming Soon. The old "usual schedule" view is
   removed; `/driver/week` (direct link) shows a Coming Soon card.
5. Company dashboard search is back, in the top bar: drivers / vans / students, and results open
   the matching page. The weekly payroll card stays out.
6. Forms stay as modals.

### 3. Backend features
**a) Van number** (`9008144` server, `68dd6dc` UI)
- Migration 20: `vans.number` text, nullable, 1–10 chars, unique per company
  (`UNIQUE(company_id, number)`; NULLs don't collide).
- `POST/PATCH /vans` accept `number` (trimmed; blank clears it; duplicate → 409). Reads return it.
  Also added to the van objects embedded in `GET /students` (school readers) and
  `GET /parent/students/:id/detail`, so every view can show "Van 04".
- UI: "Van number (optional)" in the van form. "Van 04" appears in the fleet table/drawer,
  driver header, Drivers, Assignments, Students, dashboard, payroll, school pages and the
  parent driver card. Without a number it falls back to make/model/plate as before. The CSV
  has a new "Van Number" column.

**b) Company email and city** (same commits)
- Migration 20: `companies.email`, `companies.city` (nullable).
- `PATCH /companies/me` accepts both (email validated, blank clears). Still company_admin-only
  and scoped to the caller's own company.
- UI: Email and City fields on Company profile.

**Tests:** new suite `15-van-number-company-profile` (29 checks): create/update/read,
validation, per-company uniqueness, company B can't read/change company A's van or see its
email, drivers can't edit. `01-schema` now expects 20 migrations.
**Migration applied to Neon** with `npm run migrate:up`. It's additive only, and the live
(old) app kept working.

### 4. Coming Soon (`4d047d9`, `c17cf82`)
`client/src/components/ComingSoon.tsx`: `useComingSoon()` opens a dialog ("{Feature} is
coming soon / This feature is coming soon. / OK"). `ComingSoonCard` is the in-place state. Both
are token-based, so they look the same in light, dark and the mobile shells.

| Feature | What shows now |
|---|---|
| Live map (dashboard "Live fleet") | Coming Soon card in the card (the old placeholder map is gone) |
| Parent "Van is X stops away" / live ETA | "Live location and ETA · Coming soon" row on the child card |
| Driver Week tab | Tab opens Coming Soon |
| "Paid in {month}" (payroll) | Stat card shows "Coming soon", click opens the dialog |
| Late / On time (dashboard drivers card) | "On time" / "Late" chips open Coming Soon; "On shift / Not in" stay real |

### 5. V2 list (`2621cfe`)
`V2_ROADMAP.md`: each Coming Soon item plus the V2 items from BACKLOG/spec (password reset,
self-service profile edit, parent form edit, CSV student update, alerts/notifications, SMS login,
push, auto check-out, recurring schedules, pay rate history, RLS, reporting/billing/branding/
photos/maintenance/route optimization, claim flow), each with what the user sees now, the backend
needed, and a size. It's linked from `README.md` (new "Key docs" section) and `PENDING.md`.

### 6. No dead buttons audit
- **Static:** every `<button>` has a handler or is a form submit. No `href="#"`, no empty
  handlers, no `console.log`.
- **Runtime:** using the real local API + Neon, as each role:
  - **Company admin:** every page; first row's drawer; every primary create modal; Edit inside
    each drawer; CSV menu; Add adjustment; theme toggle; sidebar collapse; dashboard search;
    Coming Soon chips/cards. Edited a van number and saved email/city through the forms.
  - **Driver:** Today (Morning/Afternoon, student sheet), a real afternoon **check-in →
    Dropped off → check-out** in the UI, Trips, Pay, Week (Coming Soon), theme, logout.
  - **Parent:** child card, Live ETA (Coming Soon), skip button (correctly unavailable, with the
    server's reason), Profile.
  - **School admin:** Students (drawer, Add a company), Pickup & drop-off (drawer, Log change
    modal, **Confirm** worked and "Waiting on you" went 1 → 0), Staff & access (drawer, Add
    staff), School profile.
  - **School staff:** Pickup & drop-off with no granted students shows only empty states,
    correctly scoped.
  - Login "Forgot password?" panel and the Register link work.
  - **0 console errors, 0 API errors.**
- **API role flows** (`server/scripts/e2e-roles.mjs`, 38/38):
  - Company admin: create school (placeholder), driver, van with number, student, assignment,
    pay rate, payroll views.
  - Driver: login, today's schedule, check in, pickup, check out.
  - Parent: sees only their child, today's status, van number.
  - School admin: sees their own school only, confirms the trip.
  - School staff: can't see ungranted students or trips.
  - Cross-company isolation on vans, students and company profile.

**Bug fixed (`65c0a25`, security):** `/students`, `/trips`, `/sessions`, `/assignments` and
`/vans` only narrowed reads for drivers and school staff, so a **parent** token got company-wide
data. I reproduced it against the running API: the parent listed another family's child with
their home address. Added a `denyRoles('parent')` guard on those five routers (the parent app
only uses `/parent/*`). Regression suite `16-parent-scope` has 21 checks. **This bug is live in
production until this branch is merged.**

**Driver accounts: how it works today (reported, not changed):**
- **A company admin creates every driver** (Drivers page → Add driver → `POST /users` with
  `role: 'driver'`). Phone, address and license number are required.
- **The admin types the driver's password.** It's a real, permanent password: no invite
  email, no temporary password, no forced change on first login.
- **Drivers cannot self-register.** `/signup` only creates company or school admins.
- **Only the admin who created the driver can change their password or email later**
  (`PATCH /users/:id`, creator-only). Older accounts with no creator recorded can be edited by
  any admin in the company.
- **No password reset exists.** The login page tells drivers to contact their company admin.
- For the mobile app you'll likely want an invite or temporary-password flow; that's a V2 item
  (password reset / self-service edit in `V2_ROADMAP.md`).

### 7. API contract (`6e7b3b3`)
`API_CONTRACT.md`, written from the routes and services:
- **Driver and parent endpoints in full:** method + path, role and scoping, request and
  response with examples, and the 400/403/404/409 cases with their real messages.
- **Other roles** in brief.
- **Auth:** JWT (HS256), 12h expiry, no refresh token, client-side logout, no password reset,
  where the web app stores the token.
- **Dates:** `YYYY-MM-DD`; "today" comes from the server DB, which is GMT right now; how to read
  DATE columns.
- **Networking:** production URL, CORS (doesn't apply to native apps), rate limits.
- **"Must NOT do" list:** V2 endpoints, computing today in UTC, parents calling company-wide
  routes, assuming `/trips` and `/sessions` only return today.

### 8. Finish
Final checks are all green (table above). `PENDING.md` is updated. `mvp-finish` is pushed.
**Stopped here.** On your OK I will:
- merge to `main` and push;
- wait for both Render deploys;
- check `/health` and that the live site shows the van number and company email/city.

---

## Commits (`origin/main..mvp-finish`, first-parent)
| Commit | What |
|---|---|
| `84f8fcb` | Merge `origin/design-refresh` (19 design commits) |
| `4d047d9` | Design decisions: early-checkout confirm, Week → Coming Soon, dashboard search; ComingSoon component |
| `9008144` | Server: van number + company email/city (migration 20), suite 15, e2e script |
| `68dd6dc` | Client: "Van 04" everywhere, van form field, company email/city |
| `c17cf82` | Coming Soon wiring: map, Late/On time, Paid in month, parent live ETA |
| `2621cfe` | `V2_ROADMAP.md` + README doc links |
| `65c0a25` | Security: parent tokens blocked from company-wide routers, suite 16 |
| `6e7b3b3` | `API_CONTRACT.md` |
| (last) | `PENDING.md` + this report |

## Bugs
**Fixed**
- Parent data exposure (above).
- Found in step 1 (the design merge), not a code bug: `01-schema` counts migrations, so it was
  updated to 20.

**Found, not fixed (bigger or needs your call)**
- **Drivers can read every student in their company**, not only assigned ones
  (`GET /students`, `/students/:id`). The driver app only asks for assigned students, but the
  API allows more. Small change once you decide (restrict to students on the driver's active
  assignments).
- **`PROJECT_STATE.md` seed accounts are stale.** Neon has no "3 Bees" company now. It holds
  Blue Ridge Transportation, Metro School Rides and Sunrise Transit Co., with schools Maple
  Grove, Oakwood High and Riverside Middle, and the documented `@3bees.test` logins don't work.
  Because of this I didn't use or touch any existing account: every check ran on data I created
  through the normal signup and admin flows.
- **Payroll month range vs timezone:** `/payroll/summary` compares `check_in_at >= 'YYYY-MM-DD'`,
  which Postgres reads as midnight in the DB timezone (GMT). That's part of the open "whose day"
  decision; not changed, per the date rule.
- Windows test harness: stray embedded-Postgres `io_worker` processes made one full run hang.
  I killed the ones from `saferoute-tms/server/node_modules/@embedded-postgres` and reran clean.

## Test data left in Neon (all created by me, safe to delete)
Everything uses `mvp…@example.test` emails or "MVP Test …" names (run id `mue67ebv`):
- **Companies (self-signup):** "MVP Test Transport mue67ebv" (admin
  `mvp-coadmin-mue67ebv@example.test`) and "MVP Test Other Co mue67ebv" (admin
  `mvp-coadmin2-mue67ebv@example.test`).
- **School (self-signup):** "MVP Test Elementary mue67ebv" (admin
  `mvp-schooladmin-mue67ebv@example.test`), with staff `mvp-staff-mue67ebv@example.test`.
- **School placeholder:** "MVP Test School mue67ebv".
- **Driver:** `mvp-driver-mue67ebv@example.test` (pay rate $20/hr).
- **Parent:** `mvp-parent-mue67ebv@example.test`.
- **Van:** plate `MVP-mue67ebv`, number `04`.
- **Students:** "MVP Test Student mue67ebv" and "MVP Test Other Family Child".
- **Activity:** one assignment, one parent link, 2 shifts (sessions), 2 trips.
- **Company profile:** "MVP Test Transport" has email/city/phone set.
- All passwords: `Secret123!`.
- Nothing belonging to the existing companies, schools or admin accounts was created, changed
  or deleted.

## Things I wasn't sure about
- "Do not delete the 3 Bees company": there is no 3 Bees company in Neon now (see above), so
  that rule had nothing to act on. Nothing existing was deleted.
- "Unique per company if easy": done as a real DB constraint, with a readable 409 message.
- "Late / On time is coming soon": I added "On time" / "Late" chips that open Coming Soon, next
  to the real All / On shift / Not in chips. If you'd rather hide them, it's a two-line removal.
- The Coming Soon dialog title names the feature ("Live map is coming soon") above your
  requested line "This feature is coming soon."
