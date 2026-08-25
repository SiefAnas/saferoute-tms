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

## 2. The 4 roles

One user account = one role = exactly one org. This is enforced at the database level, not
just in app logic (see `users_tenant_scope_check` in migration 003), so it is literally
impossible to insert a user row that is half company-side and half school-side.

| Role | Belongs to | Can do |
|---|---|---|
| `company_admin` | a company | manage vans, drivers, students (company side), assignments, pay rules, see driver activity |
| `driver` | a company | check in/out of shift, see today's schedule, log pickups/dropoffs, see own pay |
| `school_admin` | a school | manage own school profile, manage school staff, grant staff access to specific students |
| `school_staff` | a school | see only the students they were granted access to, confirm trips for those students |

All 4 roles log in through the same single `/login` page (one shared login, not 4 separate
portals). The JWT only carries identity (`user_id`). Every request re-derives role, tenant,
`is_active`, and `email_verified_at` fresh from the database, so a stale or leaked token
cannot be used to widen access after e.g. a role change or deactivation.

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
- **vans** - company-scoped, plate/model/year.
- **students** - carries BOTH `company_id` and `school_id`. Primary guardian contact is
  simple fields on the row (`parent_name`, `parent_phone`), deliberately not a separate
  table for the primary contact. `student_contacts` is a separate table only for
  *additional* contacts beyond the primary one (e.g. a second emergency contact).
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
  over time is v2, only the current rate is tracked now.
- **pay_adjustments** - freeform extra-work line items per driver (overtime, one-off
  tasks, covering a shift, or manual corrections). Deliberately uncategorized, just an
  amount + note + date. Amount can be negative for corrections.
- **email_verification_tokens** - stores a HASH of the token, never the raw value.

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
- `schedule`: `/today` (driver's day, built from assignments + overrides)
- `staffAccess`: grant/list/revoke (school_admin only)
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
| `/company` | company_admin | driver status, fleet list, payroll summary, "Add Driver" |
| `/company/students`, `/vans`, `/assignments`, `/payroll` | company_admin | management pages |
| `/school-admin` | school_admin | student search/filter |
| `/school-admin/profile` | school_admin | edit own org info |
| `/school-admin/staff` | school_admin | create staff, grant/revoke per-student access |
| `/school-staff` | school_staff | granted students, pending confirmations with driver name+phone, confirm button |

## 8. Deliberately not built yet (v2 / open decisions, not bugs)

- **Postgres Row-Level Security** - would add a third enforcement layer on top of the
  DB-composite-FK + app-scoped-accessor that already exist. Large, invasive change (every
  table, plus per-request session-variable handling in the connection pool). Parked
  pending a real go/no-go, not started.
- **Real email transport** - dev mailer currently just logs "sent" emails to the server
  console. Swapping in a real provider (SMTP/Postmark/SendGrid/SES) needs credentials only
  you can provide. The mailer interface is already pluggable, this is a config change when
  ready, not a rewrite.
- **Forgot password flow** - not built.
- **Van/assignment/payroll *management* UI gaps for company_admin** - some backend
  endpoints exist and are tested with no frontend yet (check current state before
  assuming, this may have closed since last verified).
- **Student creation UI** - `POST /students` backend exists (company_admin only), no form
  built yet, seed data was created via direct API calls during testing.
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

- **2026-08-25**: file created, reconstructed from migrations/routes/existing docs since
  the original spec file was never actually in the repo.
