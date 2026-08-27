# TMS Project Spec (v2 - reconstructed)

*Created: 2026-08-25. Update this line (or add a dated changelog entry at the bottom,
section 12) whenever a real scope decision changes, so anyone opening this file can tell
how current it is.*

Note on this document: the original `TMS_PROJECT_SPEC_1.md` that earlier sessions
referenced as "single source of truth" was never actually committed to this repo (checked
full git history, it is not there, not deleted either, just never saved as a real file).
This version is rebuilt directly from what is true in the code right now: the migrations,
the middleware, the routes, and the existing `PROJECT_STATE.md` / `BACKLOG.md` notes. Where
a decision is documented in a code comment, it is kept here word for word in meaning.
Going forward, this file should be the thing you paste into every new Claude Code session,
so it does not have to re-guess the vision from git history each time.

---

## 1. What this app is

SafeRoute TMS is a multi-tenant Transportation Management System for school van/shuttle
services. It connects two kinds of organizations:

- **Transportation companies** (own vans, employ drivers, get paid)
- **Schools** (have students who need to be picked up/dropped off)

A company can serve many schools. A school can work with many companies. A student always
belongs to exactly one company AND one school at the same time (that pairing is how a
student gets transported).

Fresh rewrite of an earlier native-Android prototype. This version is a web SaaS first,
Android app is planned next as a second client on top of the same backend.

## 2. The 5 roles

One user account = one role = exactly one org. This is enforced at the database level, not
just in app logic (see `users_tenant_scope_check`, originally migration 003, extended by
migration 011 to add `parent`), so it is literally impossible to insert a user row that is
half company-side and half school-side.

| Role | Belongs to | Can do |
|---|---|---|
| `company_admin` | a company | manage vans, drivers, parents, students (company side), assignments, pay rules, see driver activity |
| `driver` | a company | check in/out of shift, see today's schedule, log pickups/dropoffs, see own pay |
| `parent` | a company | see their linked student(s) (many-to-many via `parent_students`), skip today's morning pickup |
| `school_admin` | a school | manage own school profile, manage school staff, grant staff access to specific students |
| `school_staff` | a school | see only the students they were granted access to, confirm trips for those students |

All 5 roles log in through the same single `/login` page (one shared login, not 5 separate
portals). The JWT only carries identity (`user_id`). Every request re-derives role, tenant,
`is_active`, and `email_verified_at` fresh from the database, so a stale or leaked token
cannot be used to widen access after e.g. a role change or deactivation.

### 2.1 Who can create which accounts (added 2026-08-25)

Narrower than "any admin can create any account in their tenant" — each admin role has an
exact, enumerated creatable list, not "everything on my side":

- `company_admin` can create `driver` and `parent` accounts only — **not** another
  `company_admin` (that used to be allowed; narrowed this session per explicit instruction).
- `school_admin` can create `school_staff` accounts only — **not** another `school_admin`
  (same narrowing).
- Neither can create across the company/school line (unchanged, pre-existing gate).
- The public `/register` self-serve signup flow (fresh company_admin/school_admin orgs) is
  untouched — this narrowing only applies to admin-created accounts via `POST /users`.

**Creator-only edit**: only the admin who created an account (`users.created_by_user_id`,
new column) may edit its password, email, or profile info (`PATCH /users/:id` now checks
this, not just "any admin in the tenant"). Rows with no recorded creator — every account
that existed before this column, plus any self-serve `company_admin`/`school_admin`
signup — are grandfathered: editable by any same-tenant admin, matching the old behavior,
rather than uneditable by anyone.

**No self-service edit**: `driver`, `parent`, and `school_staff` never had a self-edit route
for their own password/email in this codebase — there was nothing to remove. Confirmed and
now explicitly tested (`server/test/09-parent-and-permissions.test.cjs`) rather than assumed.

**"Forgot password"**: shown on the shared `/login` page for driver/parent/school_staff only.
No real reset — clicking it asks the visitor to self-report which of the three they are (the
login page can't know their real role pre-auth, since it's one shared login for all roles),
then shows a static contact message (staff → "contact your school", driver/parent →
"contact your company"). `/register` was left completely untouched, per instruction.

## 3. Multi-tenancy (the most important architectural decision)

Every company-side table is scoped by `company_id`. Every school-side table is scoped by
`school_id`. `students` and `trips` carry both, since a trip touches both a company (who
drives) and a school (whose student).

This is enforced twice, on purpose, not redundantly:

1. **DB layer**: composite foreign keys everywhere (e.g. an assignment's student, driver,
   and van must all resolve to the SAME `company_id`, checked by Postgres itself, not app
   code). If somehow buggy app code tried to link a student from Company A to a driver from
   Company B, the database itself would reject the insert.
2. **App layer**: a scoped accessor (`server/src/db/scoped.js`, exposed as `req.db`) that
   makes writing an unscoped query structurally awkward. Every route handler gets a `req.db`
   already bound to the caller's tenant.

Optional third layer (Postgres Row-Level Security) is a parked decision, not built, see
section 8.

## 4. Data model

Core tables (all UUID primary keys via `gen_random_uuid()`, all timestamps `timestamptz`
UTC, money always stored as integer cents, never float, GPS as `numeric(9,6)`, never float):

- **companies** / **schools** - both are top-level tenants. Both support the claim/
  placeholder pattern (section 6): a self-serve signup is born `claimed`; a placeholder
  created by "the other side" (e.g. a company adding a school it works with, before that
  school has its own account) stays `unclaimed` until the real org claims it.
- **users** - one role, one org, see section 2.
- **vans** - company-scoped, plate/brand/model/year/color/assigned driver (`driver_user_id`,
  added 2026-08-27 — a general "which driver has this van" assignment, distinct from the
  per-student `assignments` table's date-ranged pickup/dropoff assignment). brand/model/year
  are DB-required; color/driver_user_id are DB-nullable but required by the create form/API
  (no historical data to backfill them with — see BACKLOG.md's matching entry).
- **students** - carries BOTH `company_id` and `school_id`. Primary guardian contact is
  simple fields on the row (`parent_name`, `parent_phone`), deliberately not a separate
  table for the primary contact. `student_contacts` is a separate table only for
  *additional* contacts beyond the primary one (e.g. a second emergency contact, or extra
  parents/guardians added via the Students page's "Add another parent/guardian" flow, added
  2026-08-27). Home address is `street_address`/`city`/`state`/`zip_code` (replaced the old
  single free-text `address` column, added 2026-08-27 — no real data existed in it).
- **sessions** - a driver's shift (check in / check out, with GPS at each end, duration
  computed at checkout). Named "sessions" for driver shifts, NOT auth sessions, auth is
  pure JWT with no session table, to avoid the name collision.
- **trips** - a single pickup or dropoff inside a shift. Requires two-way confirmation
  (driver AND school staff). If only one side confirms, a 5-minute auto-complete sweep
  finishes it anyway, so a trip never gets permanently stuck pending.
- **assignments** - links student + driver + van, with a start/end date range (so history
  and temporary reassignment both work). Carries a "usual" pickup/dropoff time.
- **assignment_schedule_overrides** - one-off exception per (assignment, date): a different
  time that day, or a full skip. A full recurring weekly pattern (e.g. "no pickups on
  Fridays") is explicitly NOT built, this is v2.
- **staff_student_access** - which `school_staff` user can see which student, granted by a
  `school_admin`. Static grant, no date range.
- **pay_rules** - one current rate per driver (hourly or daily), in cents. Rate history
  over time is v2, only the current rate is tracked now. `paid_through_at` (added
  2026-08-27) marks the current unpaid cycle's start — NULL means "never paid, everything
  since the beginning is owed." Set by the Payroll page's "Paid" button.
- **pay_adjustments** - freeform extra-work line items per driver (overtime, one-off
  tasks, covering a shift, or manual corrections). Deliberately uncategorized, just an
  amount + note + date. Amount can be negative for corrections.
- **email_verification_tokens** - stores a HASH of the token, never the raw value.
- **parent_students** (added 2026-08-25) - many-to-many link between a `parent` account and
  the student(s) they can see, granted by a `company_admin` (mirrors `staff_student_access`'s
  shape/constraints exactly, but company-scoped since `parent` is a company-side role).
- **pickup_skips** (added 2026-08-25) - one row per (student, calendar date) a parent skips
  morning pickup for. Real feature, not mockup — backs the Parent Dashboard's "Skip Today's
  Pickup" button, which the task explicitly called out as needing genuine notification
  logic. Unique on (student, date), which doubles as the double-submit guard.
- **pickup_no_shows** (added 2026-08-27) - the driver-side counterpart: one row per (student,
  date) a driver reports "arrived, no one showed up." Same shape/guard as `pickup_skips`.
  Both tables are the two signals a future "absent students today" Dashboard stat will read
  from — not built yet, deliberately deferred (see §7's Dashboard note).

## 5. Auth and the claim/placeholder pattern

### 5.1 Login
Single login page, all 4 roles. Password auth, JWT issued on success.

### 5.2 / 5.3 Claim and placeholder flow
This solves a real chicken-and-egg problem: a company might add a school to their system
before that school has ever signed up for SafeRoute themselves (or vice versa). So:

- If you create a company/school placeholder for the "other side" (e.g. company_admin adds
  a new school while creating a student), that org starts as `unclaimed`.
- When the real school later signs up and matches themselves to that placeholder, it moves
  to `pending_claim` (locked to one claimant, 24 hour TTL) then `claimed` once they verify
  email.
- Self-serve signups (no placeholder involved) are born `claimed` directly, no verification
  wait, since there's no ambiguity about who owns the account.

**Current status**: the claim flow's mode toggle on `/register` is hidden right now
(`CLAIM_FLOW_ENABLED = false`). Registration currently only creates brand-new orgs. The
backend and the claim UI are NOT deleted, just parked, flip the flag back if needed. This
was a deliberate scope-narrowing decision, not a removed feature.

## 6. Business rules worth knowing

- A student needs an assignment (driver + van) before trips can be logged for them.
- A trip is either `pending` or `complete`. Complete happens two ways: both sides confirm
  manually, or 5 minutes pass with at least one side confirmed (auto-complete sweep).
- A driver forgetting to check out just leaves `check_out_at` null forever in MVP, no
  auto-close, no notification. That is a known, accepted gap for MVP, not a bug.
- Pay is either hourly or daily per driver (one rate at a time), plus any number of
  freeform adjustments. `GET /payroll/summary/:driverId` is what the driver's own pay
  visibility on their dashboard reads from.

## 7. What's actually built right now (as of last verified state, 2026-07-23)

### Backend (server/)
All routes below exist and are tested (`server/test/*.test.cjs`, 7 suites):

- `auth`: login, `/me`, verify-email, resend-verification
- `signup`: create org (+ claimable search, currently unused by the frontend since claim
  flow is parked)
- `users`: create/list/get/patch (admin-only, used for "add a driver"/"add staff")
- `vans`, `students` (+ contacts sub-routes): full CRUD, company_admin only for writes
- `assignments` (+ overrides sub-routes): full CRUD, company_admin only for writes
- `sessions`: checkin/checkout, list, get (driver's own shift data)
- `trips`: create, confirm, list, get
- `schedule`: `/today` (driver's day, built from assignments + overrides, now also surfacing
  `parent_skipped_today`/`no_show_reported_today` per item), `POST /:assignmentId/no-show`
  (added 2026-08-27, driver-only — the real "Mark Absent" feature, requires an open shift
  like `logTrip`, notifies company + school admins via the same shared helper as the parent
  Skip Pickup feature)
- `staffAccess`: grant/list/revoke (school_admin only)
- `parentAccess` (added 2026-08-25): grant/list/revoke parent<->student links, at
  `/parent-access`, company_admin only — the company-side counterpart to `staffAccess`.
- `parentPortal` (added 2026-08-25): `GET /parent/students` (own linked students),
  `GET /parent/students/:id/skip-status` and `POST /parent/students/:id/skip-pickup` (the
  real Skip Today's Pickup flow — server-authoritative eligibility, sends real notifications
  via the existing mailer to the school, the assigned driver, and company admins). parent
  role only.
- `schools`: list (company_admin, scoped to schools their company has a student at),
  `/me` get+patch (school_admin's own org profile), `/:id` get (company_admin or driver)
- `payroll`: rules (put/get), adjustments (post), summary per driver

### Frontend (client/), all 4 roles have working, live-tested pages, not stubs

| Route | Role | Notes |
|---|---|---|
| `/login` | public | shared login |
| `/register` | public | create-new org only right now (claim mode hidden) |
| `/verify-email` | public | real token-in-URL flow |
| `/driver` | driver | today's schedule, check-in/out with GPS, student/school detail modals, month calendar of trip history, pay-aware "this month" card |
| `/company` | company_admin | light overview (fleet list, payroll summary) — driver status and account management moved out (2026-08-27); a real stat-card overview is a deferred follow-up |
| `/company/drivers` (added 2026-08-27) | company_admin | Live Driver Status + Add Driver + edit/deactivate (moved off the dashboard) |
| `/company/parents` (added 2026-08-27) | company_admin | Add Parent + full link/unlink student-access management (mirrors Staff & Access) + edit/deactivate |
| `/company/students`, `/vans`, `/assignments`, `/payroll` | company_admin | management pages |
| `/school-admin` | school_admin | student search/filter |
| `/school-admin/profile` | school_admin | edit own org info |
| `/school-admin/staff` | school_admin | create staff, grant/revoke per-student access |
| `/school-staff` | school_staff | granted students, pending confirmations with driver name+phone, confirm button |
| `/parent` | parent | real, minimal: linked students + a working Skip Today's Pickup button. Not the full designed dashboard yet — see below. |

**Parent Dashboard — mockup, not yet real (added 2026-08-25)**: the fully-designed dashboard
(per-student vehicle info, trip timeline, static route map, Contact Driver) exists only as an
isolated, unrouted mockup at `client/src/mockups/parent-dashboard/ParentDashboardMockup.tsx`
— fake data throughout, reachable only via a **temporary** unauthenticated
`/mockup/parent-dashboard` route added to `App.tsx` for design review (remove before any real
deploy). The one real thing in that mockup is the Skip button's eligibility state machine
(genuine wall-clock logic) and its "Confirm" action, which calls the real, tested backend
endpoint above. No reference image was actually attached in the session that built this —
flagged for Anas to compare against the real Stitch export when available. When the design is
approved, fold its content into the real `/parent` page above and delete the mockup route.

## 8. Deliberately not built yet (v2 / open decisions, not bugs)

- **Postgres Row-Level Security** - would add a third enforcement layer on top of the
  DB-composite-FK + app-scoped-accessor that already exist. Large, invasive change (every
  table, plus per-request session-variable handling in the connection pool). Parked
  pending a real go/no-go, not started.
- **Real email transport** - code done as of 2026-08-25 (see section 12): `mailer.js`
  supports real SMTP send via `nodemailer`, auto-activated by `SMTP_HOST`, target provider
  Resend. What remains is not code — Anas needs to enter the Resend API key and related
  SMTP env vars into Render's dashboard himself, then a live end-to-end send needs
  verifying. `NODE_ENV=test` always stays on the dev transport regardless of SMTP config.
- **Forgot password flow** - not built.
- **Recurring weekly schedule pattern** - only single-day overrides exist, no "repeat every
  Friday" mechanism.
- **Rate history over time for pay_rules** - only current rate tracked.
- **Reporting, notifications, billing, per-tenant branding, photo uploads, van maintenance,
  route optimization** - all explicitly out of scope until after MVP.

## 9. Android app (planned, not started)

Goal: same functionality as the React web app, native Android (Kotlin/Java), reusing the
existing Express REST API as-is, no backend rewrite needed.

Not yet decided: whether all 4 roles need a native app on day one, or just `driver` first
(the role that is actually mobile/in-the-field, versus the 3 admin-style roles that may be
fine staying desktop-web-only for longer). This should be an explicit decision before
starting, not assumed.

## 10. Build order followed so far

1. Schema & migrations (done)
2. Auth & RBAC middleware, tenant scoping (done)
3. Core Express API routes (done)
4. React frontend, reusing the Stitch design system for visual direction (done, all 4
   roles, with documented gaps in section 8)
5. MVP sign-off (next)
6. Android app (after MVP ships)

## 11. How to use this file

Paste this whole file at the start of a new Claude Code (or any Claude) session working on
this project, before describing the specific task. This gives the session the real current
state instead of it having to reconstruct scope from migrations and commit messages, which
is part of what caused earlier confusion between vision and execution.

Keep this file updated when a real scope decision changes (not for routine implementation
details, that still belongs in `BACKLOG.md`/`PROJECT_STATE.md`'s session-log style).

**End-of-session rule**: before closing a session, add a short dated entry below (what
changed in scope/vision, not implementation detail, that stays in `BACKLOG.md`/
`PROJECT_STATE.md`). If nothing about scope changed this session, no entry needed.

## 12. Changelog

- **2026-08-27 (latest)**: removed the Parent Dashboard mockup entirely (route + file) —
  it had been left unauthenticated on the live public site since the earlier push and
  needed to come down immediately; pushed that fix on its own before anything else. The
  real `/parent` page (§7) now shows real vehicle/driver/trip-timeline data (new
  `GET /parent/students/:id/detail`), replacing what the mockup used to demonstrate. A real
  dummy `parent` account now exists, following the same pattern as the dummy driver/admin
  accounts — see `BACKLOG.md`'s matching entry for credentials and a live-data anomaly
  found while setting it up (evidence of Anas already testing the new Parents feature
  himself on the shared dev DB, not a bug — left his test data alone).
- **2026-08-27 (later)**: Fleet/Students/Payroll page enhancements. Fleet: vans gained
  brand (split from the old single `model` field, real data backfilled by re-parsing),
  color, and a required assigned driver; plate/year now required too. Students: home address
  split into street/city/state/zip (replacing the old unused `address` column), every field
  but Notes now required, and an "Add another parent/guardian" flow (plain
  `student_contacts` rows, explicitly NOT new parent login accounts). Payroll: driver
  work-time tracking **already existed** (sessions.check_in_at/check_out_at, already used by
  `summary()`) — checked before building anything, per instruction, so this stayed the
  smaller-scope case. Added a "Paid" cycle (`pay_rules.paid_through_at`), a per-driver
  Amount Owed + Worked-This-Cycle column, and a click-through breakdown modal. Found and
  fixed a real pre-existing bug while building this: `summary()` never filtered adjustments
  by date range at all, so every historical adjustment bled into every later summary
  (including drivers' own "this month" dashboard card) — now filtered by `work_date` exactly
  like sessions are filtered by `check_in_at`. Full detail, including the exact assumptions
  made on required-field enforcement (DB nullable + API-layer required, continuing this
  codebase's existing precedent) and the live verification performed, in `BACKLOG.md`'s
  matching entry.
- **2026-08-27**: company_admin nav restructured per Anas's explicit request — Driver and
  Parent split into their own pages (`/company/drivers`, `/company/parents`), each with full
  create + edit/deactivate (driver) or create + edit/deactivate + link/unlink (parent), nav
  order now Dashboard/Driver/Fleet/Students/Parents/Assignments/Payroll. The Dashboard itself
  is intentionally left as a lighter placeholder for now — Anas asked to hold off on a real
  "overall status" redesign until a follow-up pass, rather than have it guessed at here. Also
  added, from Anas's own idea during this conversation: a real driver-side "Mark Absent"
  no-show button (`pickup_no_shows` table, `POST /schedule/:id/no-show`), notifying company +
  school admins the same way the parent's Skip Pickup does — the two signals (`pickup_skips` +
  `pickup_no_shows`) are what the deferred Dashboard stat will eventually read from. Full
  detail, including the clarifying questions asked and answered before building this, in
  `BACKLOG.md`'s matching entry.
- **2026-08-25 (later still)**: new `parent` role + account-permission changes (real, not
  mockup), plus an isolated Parent Dashboard design mockup. Ran autonomously while Anas was
  away, per his explicit instruction to make reasonable assumptions and keep going rather
  than block. Full detail in `BACKLOG.md`'s matching entry, including every assumption
  flagged for confirmation (there are several — the shared-login "forgot password" mechanism,
  the grandfathered-NULL-creator edit rule, timezone handling on the skip-eligibility check,
  and the fact no reference image actually reached this session). Section 2 above rewritten
  for 5 roles; section 4 gained `parent_students`/`pickup_skips`; section 7 gained the new
  routes and a real (if minimal) `/parent` page plus the separate design mockup.
- **2026-08-25**: file created, reconstructed from migrations/routes/existing docs since
  the original spec file was never actually in the repo.
- **2026-08-25**: safety pass ahead of real company data (3 Bees Transportation) going
  live. Section 8's "Real email transport" item moves from "not built" to "code done,
  pending Anas's own SMTP credential entry on Render" — `mailer.js` now sends via
  `nodemailer` over SMTP (Resend), gated on `SMTP_HOST`, dev transport still used whenever
  that's unset or under `NODE_ENV=test`. Also added (new capabilities, not previously
  listed anywhere in this spec): `config.js` now refuses to boot in production without a
  real `JWT_SECRET`/`DATABASE_URL`, and a daily automated Neon DB backup now exists
  (`.github/workflows/db-backup.yml`, 90-day artifact retention). Full detail in
  `BACKLOG.md`/`PROJECT_STATE.md`'s 2026-08-25 entries, including what's still pending
  (live Resend send not yet verified — blocked on Anas entering the API key himself).
- **2026-08-25**: `JWT_SECRET` rotated on Render, done directly by Anas in Render's own
  dashboard, outside any Claude Code session. Per Anas: it was possibly still the code's
  insecure default before this; it's now a genuinely random value. Not independently
  verified by this session (no Render env-var access) — recorded as reported.
- **2026-08-25**: corrected two stale items in section 8 — "Van/assignment/payroll
  management UI gaps" and "Student creation UI" were both already fully built (create/
  edit/delete for vans, full assignment lifecycle + schedule overrides, pay rate +
  adjustment entry, and student creation with existing/new-school choice + contacts
  manager), already routed in `App.tsx`, already in the company_admin sidebar. This
  session verified each live against the real dev Neon DB (create/edit/delete round-trips
  through the actual UI, not just a code read) rather than building duplicates. Section 7's
  route table already correctly listed these as built; section 8 had gone stale relative to
  it. One genuine gap surfaced during verification, tracked in `BACKLOG.md` instead (not a
  scope question): `DELETE /students/:id` exists on the backend but the Students page has
  no delete button in the UI.
