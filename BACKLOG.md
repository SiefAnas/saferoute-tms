# Backlog

<!-- Live test: confirming Anas connected saferoute-tms to Render via the dashboard, so a
     plain push actually auto-deploys (see BACKLOG item #8 for why this didn't work before). -->

Deferred items surfaced during implementation. Spec §9 already tracks the broader v2 list
(reporting, notifications system, billing, branding, photos, van maintenance); this file is
for things noticed while building that aren't in the spec's own backlog.

## 2026-09-02 — Parent dashboard mobile redesign + school staff/admin pickup-confirmation workflow

Two-part task. Part 2 explicitly warned to check how a new confirmation status would
interact with existing Assignments/pickup/dropoff data before building anything — worth
reading in full since almost every real decision here came out of that investigation.

### Part 1 — Parent dashboard mobile fixes

- **Logout button**: already existed (`ParentLayout.tsx`'s top-right header icon) — verified
  live at a 375px mobile viewport before touching anything, confirmed visible and working.
  Not missing; no duplicate added.
- **Compact default view**: student name, grade, company name, van type (brand+model) —
  replaces the old always-visible map placeholder + fake "5 mins away" countdown + full
  van-detail grid. The fake MapHero/StatusCard components are gone, not just hidden — they
  were static placeholders with no real data, exactly the kind of bulk "make it compact"
  should remove, not relocate.
- **"More info" expand** reveals: company phone, driver name + phone, and the parent's own
  full account info (name/email/phone/address) — plus the van detail grid and real trip
  timeline (legitimate extra detail, not fake, so kept behind the expand rather than deleted).
  Skip Pickup and Contact Driver stay always-visible (core actions, not "info").
- **Two real gaps found and filled to make this possible**:
  - `companies` had no `phone` column at all, and no self-service profile page existed for
    company_admin (unlike school_admin's `SchoolProfilePage`) — "company phone" would have
    been permanently blank otherwise. Added the column + `GET/PATCH /companies/me` (mirrors
    `schools/me` exactly) + a new `CompanyProfilePage.tsx` nav entry.
  - The parent's own phone/address aren't on the cached `AuthUser` (JWT-derived, client-side)
    and there was no self-read route a parent could hit (`users.js` is admin-only). New
    `GET /parent/me`, fetched fresh (not trusted from a possibly-stale cache) only when
    "More info" is actually opened.

### Part 2 — School staff/admin pickup-confirmation workflow

**The investigation, before writing anything**: this app already has a two-way trip
confirmation system (`trips` table: driver logs a trip = driver's confirmation; school_staff
confirms = the other half; a 5-minute in-process sweep, `autoCompleteStaleTrips`, already
auto-completes anything left half-confirmed) built in an earlier step. The morning/afternoon
"received at school" / "received by driver" flow asked for here **is that exact mechanism**,
not a new one — so this task is almost entirely about *extending* existing pieces rather than
building new ones, and the two real structural conflicts were about who's allowed to touch
what, not about the confirmation concept itself.

1. **Morning/afternoon confirmation**: `confirmTrip`'s role check was `school_staff` only
   (`school_admin` had no way to confirm anything). Extended to
   `['school_staff', 'school_admin']` — same `requireRole('company_admin', 'school_admin')`
   pairing already used in `users.js`. The 5-minute auto-confirm was already exactly the
   asked-for behavior; a TODO was added directly on `autoCompleteStaleTrips()` per the
   explicit ask: V2 should replace the silent auto-confirm with a staff/admin reminder +
   an admin notification on timeout, not just marking it complete as if someone confirmed it.

2. **Absence visibility** (Skip Pickup / Mark Absent): `GET /dashboard/absent-today` was
   `company_admin`-only. **Real structural conflict**: `pickup_skips` and `pickup_no_shows`
   have no `school_id` column at all (company-tenant-only tables) — a school-tenant caller's
   `req.db` can't reach them at all (`ScopeError`, not just permission-denied). Resolved by
   branching the service on caller role: company_admin keeps the original `req.db` path
   unchanged; school_admin/school_staff get a new raw-pool query joining through `students`
   on `school_id` — same precedent `schedule.js`'s `getTodaySchedule` already established for
   a query shape the scoped accessor's equality-only `where` can't express. school_staff is
   further narrowed to their granted students (`staff_student_access`), matching the same
   least-privilege sub-scope `trips.js` already applies to that role. No schema change to
   either source table.

3. **"Left early" / "staying later"**: genuinely new — nothing existing fits a same-day,
   actor-attributed log with its own notification trail (`assignment_schedule_overrides` is
   a pre-planned, company_admin-only, whole-day override; closer in *spirit* to
   `pickup_skips`/`pickup_no_shows`, just needing two change types). New dual-tenant
   `schedule_changes` table (`company_id` + `school_id`, same composite-FK-to-students pattern
   as `trips`), service, and `POST/GET /schedule-changes`, gated to `school_staff`/
   `school_admin`.
   - **"Left early" cancels today's scheduled company pickup** by reusing the *existing*
     `assignment_schedule_overrides.skip` flag (the same one `company_admin` already sets
     manually) — not a new parallel "skip" concept. **Real structural conflict**: that table
     is company-tenant-only too, so a school-tenant actor's `req.db` can't write to it either.
     Resolved with a raw-pool write, ownership enforced by the JOIN itself (only assignments
     for a student at *this actor's own school*) — same cross-tenant-write precedent
     `placeholders.js` already established for company/school actors editing each other's
     stub records. Safe to apply as a whole-day skip (no separate pickup/dropoff leg
     tracking exists, and none was added): by the time staff would log "left early," the
     morning dropoff already happened and is already recorded in `trips` — a forward-looking
     skip has no retroactive effect on it.
   - **"Staying later" is notification-only**, exactly as asked — logs the row, sends the
     same notification, touches no override.
   - **Notifies company_admin + school_admin + the student's currently-assigned driver +
     their linked parent(s)** — a recipient set no existing helper fully covered.
   - **Real bug found and fixed while wiring this up**: the shared `notifyCompanyAndSchoolAdmins`
     helper looked up company admins via `req.db.findMany('users', {where:{role:'company_admin'}})`
     — which only ever worked because its two existing callers (driver's no-show, parent's
     skip-pickup) are themselves company-tenant, so `req.db`'s own scoping happened to match.
     Called from a school-tenant actor (this feature), that same call silently scoped to
     `school_id` instead and returned zero company admins — no error, just a missing
     recipient, caught by the new test asserting the exact recipient list rather than just
     "notified.length > 0". Fixed by making `companyId` an explicit parameter instead of
     inferred from the caller's own tenant; all three callers (existing two + this one)
     updated to pass it explicitly.

**Verification**: new `server/test/13-pickup-confirmation.test.cjs` (27 assertions) covering
every role-gate, the school-scoped absent-today branch + its least-privilege sub-scope, the
company profile endpoint, `/parent/me`, and both schedule-change types — including asserting
the *exact* 4-recipient notification list (not just a count) so the tenant-scoping bug above
couldn't have slipped through unnoticed. Full backend suite: 13/13 suites (one pre-existing
test updated: `01-schema.test.cjs`'s hardcoded migration count, 17 -> 18). `tsc -b`, lint, and
`vite build` clean. Live-verified end-to-end against the real dev server + the same Neon DB
the whole project uses: logged a real "left early" as school_admin, confirmed the exact 4
`[mail]` lines fired with the correct recipients, confirmed `assignment_schedule_overrides`
actually flipped to `skip=true` for today via a direct DB check, confirmed a driver's own
`/schedule/today` reflects it; confirmed a real pending trip as school_admin (previously
403); set a real company phone via the new Company Profile page and confirmed it flows
through to the parent dashboard's "More info" panel; confirmed the mobile compact view and
expand panel render exactly as specified at a 375px viewport. Migration
(`1752624000018_schedule-changes-and-company-phone`) applied to the live Neon DB. Test-only
data (a trial trip, a schedule-change log, its override) cleaned up after verification.

## 2026-09-01 — Payroll/Assignments modals, Parents table redesign, parent<->student auto-match

Four-item batch, same day as the modal/required-fields/click-to-call batch below.

1. **Modal-ify the remaining "Add a..." forms** — Payroll's "Set Pay Rate" and "Add
   Adjustment" (were two permanent side Cards), and Assignments' "New Assignment" (was a
   permanent side Card). Same pattern as the earlier batch: a header button opens a `Modal`,
   closes on submit/cancel. Assignments' existing live conflict-filtering (driver/van
   lock-in, excluded students) carried over unchanged — it was already keyed off component
   state, not the old layout.

2. **Parents page rebuilt as a real table**, matching Drivers/Students: Name, Email, Phone,
   Address, Linked Students columns. The old design was a plain list + a separate side panel
   that needed a parent selected first; the per-parent student-access checklist still exists
   with identical link/unlink behavior, just as an expandable row under each parent (same
   pattern as Students' "Contacts" panel) instead of a side panel.

3. **Add a Parent popup**: added required Phone + Address fields (previously only Full
   name/Email/Password — parent accounts had no phone/address at all before this), and
   in-modal student linking — a search box filtering a scrollable checkbox list, so an admin
   can link a parent to one or more students at creation instead of only afterward through
   the access panel. Selected students get linked via the existing `/parent-access` endpoint
   right after the parent is created.
   **Convention-consistency call, not explicitly asked**: made phone/address *required* on
   parent creation (client + `server/src/services/users.js`), matching the "no optional
   fields" rule the previous batch established app-wide, and extended `EditAccountModal` to
   show/require address for parent accounts too (it was driver-only before — a parent's
   phone was already unconditionally required there, which would otherwise have blocked
   editing ANY existing parent's account, including just toggling active, until they had a
   phone on file).

4. **Parent<->Student auto-match suggestion** — the main logic piece. New
   `client/src/lib/parentMatch.ts`, entirely client-side (advisory only, never auto-links or
   writes anything by itself):
   - **Student form (add/edit)**: after a successful save, the just-saved student's guardian
     name/phone/street address are scored against every *unlinked* parent account. A
     qualifying match opens a confirm dialog — "Is `{parent}` the parent/guardian of
     `{student}`?" — showing which signals matched. "Yes" links them via the existing
     `/parent-access` POST; if the parent record is missing phone or address that the
     student form just captured, a checkbox (checked by default) offers to fill it in too,
     via a plain `PATCH /users/:id`. "No" does nothing further — manual linking through the
     Parents page's access panel still works exactly as before.
   - **Parents page access panel**: the inverse direction — each *unlinked* student row is
     scored against the currently-expanded parent, and a qualifying match gets a passive
     amber highlight + a "Possible match" badge (hover shows which signals matched) rather
     than a popup, so the admin notices it while manually reviewing the list without being
     interrupted.
   - **Matching logic, documented in code (`parentMatch.ts`'s own header comment) so the
     sensitivity can be retuned later without re-deriving it**:
     - Phone (weight 3, strong signal alone): normalized to digits-only, last 7–10 compared
       — tolerates formatting/country-code differences. Two different families essentially
       never share a phone number, so this alone clears the suggestion threshold.
     - Name (weight 1, weak alone): normalized exact match, one name containing the other
       (handles a middle name/initial), or ≥82% Levenshtein similarity. Deliberately weak on
       its own — the seed data alone has two different "Sullivan" families and two different
       "Reilly" families.
     - Street address (weight 2, weak alone): the parent's single free-text address field is
       split on the first comma for its "street" part, compared to the student's structured
       `street_address` at ≥75% similarity (more forgiving than name — "St" vs "Street" and
       similar formatting drift are common and shouldn't block a match). Deliberately weak
       alone too: the seed data's dummy street pool is intentionally reused across multiple
       *unrelated* students, so an address-only match would false-positive across the whole
       seeded dataset if it counted alone.
     - **Suggestion threshold: total score ≥ 3.** Phone alone qualifies (3). Name + address
       together qualifies (1+2=3). Name alone (1) or address alone (2) do not. To change
       sensitivity later: adjust the `WEIGHTS` object or `MATCH_THRESHOLD` at the top of
       `parentMatch.ts` — both are the only numbers that matter, not scattered through the
       call sites.
   - **Scoping decision, flagged**: matching runs against the student's *primary* guardian
     (`parent_name`/`parent_phone`, the same fields shown in the Students table) only, not
     the additional "Add another parent/guardian" rows (those are plain `student_contacts`
     text, not parent login accounts, and multiplying the match surface across every extra
     contact felt like real scope growth beyond what was asked for a first pass).
   - **Backend**: no new endpoint — matching is pure client-side computation over data both
     pages already load (`/users?role=parent`, `/students`, `/parent-access`); the actual
     link/unlink and phone/address fill-in both go through existing, already-tested routes.

**Live-data consistency**: since parent phone/address are now required going forward, the 25
already-seeded parent accounts (created before this feature, all NULL) got backfilled —
`server/scripts/backfill-required-fields.js` extended to derive each parent's phone/address
from their *first linked student's* own `parent_phone`/address (same person in the dummy
data by construction), so the seeded parents are genuine matches for their own students
under the real matching logic rather than blank-but-linked records. `seed-dummy-data.js`
updated the same way so a fresh reseed stays consistent without needing a backfill re-run.

**Verification**: full backend suite — all 12 suites passing (one test fixture updated:
parent creation in `09-parent-and-permissions.test.cjs` now sends phone/address), `tsc -b`,
lint, and `vite build` all clean. Live-verified against the real dev server + the same Neon
DB the whole project uses: Payroll/Assignments modals open and submit correctly; the Parents
table shows the backfilled phone/address/linked-students data; created a test student with a
guardian name+phone matching an existing seeded parent ("Karen Reilly" / 555-0102) and
confirmed the match dialog fired with the exact matched signals, then confirmed linking
actually happened (verified on the Parents table's Linked Students column); the Add Parent
modal's search-filtered student picker correctly narrowed the list and linked on create;
`EditAccountModal` now shows/requires a parent's address and pre-populates it correctly.
Test-only records created during verification (one student, one parent) deleted afterward.

## 2026-09-01 — Add-form modals, assignment conflict enforcement, contact links, required fields, password rules

Seven-item UI/logic batch from live screenshots.

1. **"Add a..." forms → modal**, applied consistently to Students, Drivers, Fleet, Parents,
   School Staff, and school_admin's "Add a Company" — all previously permanent side-Card
   forms, now a `Modal` triggered by a button with an icon, closing on submit/cancel.
   `EditAccountModal` was already modal-based, untouched structurally.

2. **Students table column order** → Student, Driver, School, Grade, then the existing
   Address/Parent-Guardian/Phone columns.

3. **Real assignment-conflict enforcement** (the highest-risk item — new business logic on
   the core table). Three rules, one shared overlap-conflict check: a van can't be driven by
   two different drivers over overlapping date ranges; a student can't be assigned to two
   different drivers over overlapping ranges; a driver can't be recorded driving two
   different vans over overlapping ranges (this is what makes "the van must be the one the
   driver is actually driving" enforceable — a driver's *other* overlapping rows are the
   source of truth for their van). `server/src/services/assignmentConflicts.js`, wired into
   both `POST`/`PATCH /assignments`, checked BEFORE the FK-existence check so a foreign
   van/student/driver id still gets its existing 400 rather than a spurious 409. Client-side
   mirror (`client/src/lib/assignmentRules.ts`) live-filters the pickers on both the
   Assignments page and the Students page's driver+van quick-assign: picking a driver
   auto-locks the van to whichever one they're already driving (or narrows the choices if
   not), and narrows the student list to exclude students already on a different driver.
   Backend is the actual authority — verified independently via a direct fetch bypassing the
   UI filtering entirely (assigning an already-assigned student to a different driver on the
   same van → 409, not 201). New test coverage in `04-resources.test.cjs` (7 cases: all 3
   conflict rules, the "same driver+van, different student" non-conflict, a non-overlapping
   date range succeeding, and a PATCH-triggered conflict).

4. **Drivers table**: phone (as a `tel:` link) under the name instead of email.

5. **Global click-to-call / click-to-copy (phone) and click-to-email / click-to-copy
   (email)** — new `client/src/components/ContactLink.tsx`, a small popover (Call/Copy or
   Email/Copy) replacing every plain phone/email display found across the app: Drivers,
   Students (both company and school_admin views + contacts panels), Parents, Staff & Access,
   Driver Dashboard (parent contact, school detail, additional contacts), School Staff
   Dashboard (driver contact, parent contact), Parent Profile, and the admin sidebar's own
   email. Left two spots deliberately unconverted: the Parent Home page's driver
   "Contact {name}" button (already a dedicated, more prominent call CTA — swapping it for
   the generic menu would be a downgrade, not an upgrade) and CSV export column
   values/search-matching logic (not a rendered display).

6. **All "(optional)" fields removed, made required, with hint placeholders**: driver
   phone/address/license (Add Driver form, `EditAccountModal`), student notes, "New school"
   address, and company/school placeholder address — client (`required` attr + descriptive
   placeholder) and server (`server/src/routes/students.js`, `server/src/services/users.js`,
   `server/src/services/placeholders.js`) both updated. **Two deliberate exceptions, not
   swept in**: `EditAccountModal`'s password field (blank = keep current password — making
   it required would break "don't force a password change" as a concept, not just add
   friction) and Students' driver+van assignment picker (structurally paired-optional by
   design — a student can legitimately exist with no assignment yet, same as the table
   already shows "(no driver assigned)"; this isn't a plain data field, it's a relationship
   to a separate table). Backend test fixtures updated everywhere the new requirements would
   otherwise break existing test rows (driver creation now needs phone/address/license in
   `04-resources.test.cjs`/`09-parent-and-permissions.test.cjs`, student creation now needs
   notes in all three suites that create one, placeholder creation now needs address).
   **Live data backfill**: the 6 already-seeded drivers and 18 already-seeded students
   predated this rule and had real NULLs — backfilled via a new, re-runnable, idempotent
   script (`server/scripts/backfill-required-fields.js`, `COALESCE`-guarded so it only fills
   actual NULLs, never overwrites a real value) using the same values `seed-dummy-data.js`
   would generate for a fresh seed, so the two stay consistent.

7. **Password fields everywhere**: eye-icon show/hide, `PasswordStrengthMeter`, and a
   strength-rules hint applied to every password-*setting* field app-wide (`DriversPage`,
   `ParentsPage`, `StaffAccessPage`, `EditAccountModal`) — `RegisterPage` already had this
   pattern from an earlier task, only its hint text needed the "a number" addition. Backend
   `assertPasswordStrength` (`server/src/validate.js`) now also requires a digit, matching
   the new hint text everywhere — this single shared function is what every password-setting
   code path (signup, admin-created accounts, account edits) already routes through, so one
   change enforces it everywhere at once. The existing seed password `Secret123!` already
   satisfies the new rule (contains "123"), so no reseed was needed for that. Login's own
   password field intentionally untouched beyond the eye icon it already had — strength
   rules/meter don't apply to *entering* an existing password, only to *setting* one.

**Verification**: full backend suite — all 12 suites passing (embedded Postgres, isolated;
`04-resources.test.cjs` alone at 81/81 including the new conflict-rule cases), `tsc -b`,
lint, and `vite build` all clean. Live-verified against the real dev
server + the same Neon DB the whole project uses: modal open/close on Drivers/Students/
Vans/Parents/Staff/"Add a Company"; the assignment picker's live van-lock and student-
narrowing (picking a driver correctly locked the van field and narrowed the student list to
only that driver's own students); a weak password rejected by the live API with the new
digit-inclusive message; a real driver created end-to-end through the modal with all new
required fields; the conflict rule confirmed authoritative server-side via a raw fetch that
bypassed the UI's own filtering (still got 409); click-to-call/copy and click-to-email/copy
dropdowns opening correctly without disturbing a parent/staff row's own selection state
(the row-select `<button>` had to become a `<div role="button">` for two of these lists —
`ContactLink` renders its own `<button>`, and a `<button>` can't validly nest inside
another). Test-only artifacts (one live-created driver account) cleaned up after
verification.

**Minor pre-existing issue noticed in passing, not fixed** (out of scope for this batch):
`assignments.js`'s FK-error mapping only catches Postgres code `23503` (foreign key
violation) — a syntactically invalid id (not a real UUID at all) throws a different code and
surfaces as a raw 500 instead of a 400. Not reachable through the actual UI (selects always
send real ids), only found by directly hand-crafting an API call during verification.

## 2026-08-31 — Full dummy data reset

Anas asked for a complete clean-slate reset of all dummy/test accounts and a fresh,
richer synthetic dataset. Two things flagged and confirmed before touching anything,
since this is destructive/irreversible on the shared live dev DB:

1. **What actually counts as "dummy data."** He named `admin@3bees.test` specifically to
   double-check. Investigation turned up something he *didn't* ask about that mattered
   more: `anassief1@gmail.com` (his own real email), `company_admin` of an otherwise-empty
   company called "DMO1," created 2026-07-19 — doesn't match the `.test`/seed-name
   convention at all. Flagged it explicitly rather than assuming either way. Confirmed:
   delete everything, no exceptions — DMO1, all of `3bees`/Willow Creek (`.test` convention,
   built up entirely through prior test/demo sessions per this file's own history, not a
   real customer), `Zehan@willowcreek.edu`, and `parent1@dummy.edu` ("SamaCrazy," his own
   earlier manual test of the Parents page) all confirmed for deletion.
2. **A real schema conflict in the requested parent-link cases.** One required case was
   "one parent linked to 2 kids at 2 different schools served by 2 different companies" —
   structurally impossible: `parent_students`' own composite FKs (added when the table was
   built) require the parent and the linked student to share one `company_id`; a parent
   tenant-scoped to Company A cannot link to a Company B student, full stop. Flagged with
   three concrete options (relax the case / change the schema to support cross-company
   parent links / skip the case) rather than silently substituting something. Anas chose:
   relax to "2 kids, 2 different schools, same company" — still exercises the multi-school
   spirit, no schema change.

**What was built**: `server/scripts/seed-dummy-data.js`, a real, reviewable, rerunnable
seed script (not a one-off throwaway) — 3 companies x 2 drivers (6), 3 schools x 6 staff
(18) + a school_admin each, 18 students (6/school, split across each school's two serving
companies so cross-company/cross-school relationships actually exist), 6 vans, 18 real
Assignments (student+driver+van, not the old standalone tags), and 25 parent accounts
covering all three required relationship cases (verified directly against the DB, not just
assumed from the script's logic): David Sullivan -> Ava Sullivan (Maple Grove/Co1) + Ryan
Sullivan (Oakwood/Co1) for the relaxed multi-school case; Susan Park -> Lily + Wyatt Park
(same school) for the simple 2-kids case; Benjamin Osei <- Angela Osei, Kevin Osei, and
Priscilla Adeyemi (three independent parent accounts) for the 3-guardians case. Every one
of the 18 students has at least one linked guardian (verified with a `LEFT JOIN ... IS
NULL` query, not eyeballed). Email pattern exactly as specified
(`driver1@company1.com`, `staff1@school1.com`, `parent1@company1.com`, ...), all on the
same `Secret123!` password already used throughout this project's dummy data. Company
admin/school admin accounts (not itemized in the task) got the same email convention
extended for consistency (`admin@company1.com` / `admin@school1.com`) — the one small
assumption in an otherwise fully-specified task.

**Verification**: full backend suite still passing against isolated embedded-Postgres
instances (untouched by this — data-only change, no application code modified). Live-
verified directly against the reset dev DB across three different real role logins:
company_admin (`admin@company1.com` — Live Driver Status, Fleet, Students all show the new
real data, including both Sullivan children on the Students table), the Students/Parents
pages (David Sullivan's link panel shows both Ava and Ryan marked "Linked," everyone else
"Not linked"), and a parent login (`parent1@company3.com`, one of Benjamin Osei's three
guardians) — real dashboard showing his real assigned van (VAN-301, Ford Transit 2022,
white) and real school (Riverside Middle School).

## 2026-08-28 — Search, Dashboard redesign, CSV import/export, collapsible sidebar

Four features in one batch. Part 1 of this task (the student/driver Assignment sync fix)
had already been completed and shipped in the previous entry before this prompt arrived —
nothing to redo there.

1. **Typeahead search** (Dashboard): client-side filtering of already-loaded drivers/vans/
   students, grouped results with counts ("Drivers (4)"), per explicit instruction — no new
   backend endpoint.

2. **Dashboard redesign**, adapted from Anas's reference mockup rather than cloned. Two
   things in the reference had no real backing data and needed an honest substitute:
   - "Last Sync" (implies live device telemetry) -> **"Last Activity"**, backed by each
     driver's most recent real session check-in/check-out timestamp.
   - "Recent Alerts" (mockup example: "VAN-2001 - Speeding", telemetry that doesn't exist)
     -> real alerts derived from actual data: a driver checked in unusually long ago
     (>10h) and still hasn't checked out. **ASSUMPTION, flagged**: no other "alert" concept
     exists yet in this app; this was the one honest real signal available.
   - "Fleet Summary" is just the real fleet count — there's no operational/maintenance
     status field on vans to split "operational" from anything else.
   - "Late/Absent Today" is the real hook flagged back when Skip Pickup / Mark Absent were
     built — new `GET /dashboard/absent-today` (services/dashboard.js) reads today's
     `pickup_skips` + `pickup_no_shows`, resets daily by construction (both tables keyed by
     calendar date), no acknowledged/cleared state, per instruction to keep it simple.
   - "Payroll Summary" snippet is a new `GET /payroll/summary/company` (current calendar
     week, Monday-Sunday) — reuses the existing per-driver `summary()` rather than
     duplicating its computation.
   **Real bug caught while testing**: `getAbsentToday`'s sort crashed because `pg` returns
   `timestamptz` columns as JS `Date` objects, not strings — `.localeCompare` doesn't exist
   on a `Date`. Fixed before it shipped (normalize to ISO strings first).

3. **CSV import/export**, wired into Drivers, Fleet, Students, Parents, and Payroll. Built
   one reusable piece first (`client/src/lib/csv.ts` + `components/CsvImportExport.tsx`),
   per instruction, rather than repeating the logic five times. Added `papaparse` as a new
   dependency — deliberate, not incidental: real spreadsheets exported from Excel/Sheets
   routinely have quoted commas, embedded newlines, and escaped quotes, which a hand-rolled
   `split(',')` parser would silently corrupt on real user data. Export always doubles as
   the import template (same columns either way). Import is per-row upsert with individual
   success/failure reporting, matched by the task's own stated keys:
   - **Drivers/Parents** (email): existing row -> `PATCH /users/:id` (this naturally
     enforces creator-only edit — a CSV row for an account this admin didn't create fails
     with that same 403, not a silent bypass); no match -> `POST /users`, which needs a
     real password since there's no forced-reset flow (a Password column in the
     export/template, always blank on export since we never store/return plaintext).
   - **Fleet** (license plate): existing plate -> `PATCH /vans/:id`; no match -> `POST /vans`.
   - **Payroll** (driver email): reuses `PUT /payroll/rules/:driverId`, already
     upsert-by-design (`ON CONFLICT DO UPDATE`) — no create/update branching needed.
   - **Students**: **CREATE-ONLY**, an explicit exception. **ASSUMPTION, flagged**: unlike
     people (email) and vans (plate), students have no reliable natural key —
     `full_name` alone risks silently overwriting the *wrong* student on a name collision.
     Rather than guess at a compound key, every student CSV row always inserts new; bulk
     *updating* existing students isn't supported via CSV. School is matched by name
     against the company's already-known schools (from `GET /schools`) — a row naming an
     unknown school fails with a clear message rather than guessing or creating a
     placeholder. Driver/van assignment isn't set via CSV either (no safe way to name that
     pairing per-row in bulk) — assign those afterward via the form.

4. **Collapsible sidebar**: clicking the truck icon toggles it. **ASSUMPTION, flagged**: the
   task said clicking it "hides it if open, shows it again if clicked again" taken
   literally — but a fully-hidden sidebar would hide the truck icon too, with no way to
   bring it back. Kept a slim always-visible icon rail (just the toggle button); everything
   else (title, nav labels, logout text) hides/shows with it.

**Verification**: `npx tsc -b`, lint, and `npm run build` (production bundle) all clean.
Full backend suite: **257/257 passing** across 12 suites (new `12-dashboard.test.cjs`).
Live-verified end-to-end against the real dev DB: search returned correct grouped counts
for a live query; the collapsible sidebar toggled correctly (an initial check read a stale
DOM snapshot before React's re-render committed — re-verified and confirmed working); CSV
export produced a real, correctly-formatted file from live driver data; CSV import was
verified as a genuine round-trip — updated Marcus Rodriguez's phone number via a real
uploaded CSV file, confirmed the change landed in the real database, then reverted it
immediately after.

## 2026-08-27 (latest still) — Fixed the student/van standalone driver tags, for real this time

Follow-up on the previous entry's own flagged assumption: Anas confirmed he wanted the two
sources of truth (the standalone `driver_user_id` tags vs. the real `assignments` table)
actually synced, not just documented as a risk. Checked first per his explicit instruction
("stop and flag if this touches a lot of code or breaks something load-bearing") — found a
real structural conflict, not just busywork: `assignments` is a genuine 3-way link
(student+driver+van, all `NOT NULL`), so a 2-way "driver for a student" or "driver for a
van" picker can't create a valid Assignment row by itself. Flagged this with concrete
options before touching any code; Anas chose:

- **Students**: add a van picker alongside the driver dropdown — a real "quick assignment"
  creator, reusing the existing (already company_admin-gated, tenant-scoped)
  `POST`/`PATCH /assignments` endpoints, not a new write path.
- **Fleet**: read-only — "Driver" for a van is now purely derived from whichever
  assignment(s) are active today using that van (a van can legitimately have more than one
  distinct driver, shown as a joined list); no inline driver picker on the van form at all,
  since "assign a driver to a van" would need to name a student too.

**What changed**: dropped `students.driver_user_id` and `vans.driver_user_id` entirely
(migration `1752624000017` — both were only added earlier the same day, so no real data was
ever meaningfully populated in either beyond this session's own demo setup). `POST /vans` no
longer takes or requires a driver at all. `StudentsPage.tsx`'s Add/Edit form now has a
driver+van pair (both required together or both left blank); on save it reconciles the
student's real current assignment — closes the previous one (`end_date = today`) if the
picked driver/van changed, opens a new one if now set, no-ops if unchanged. Both
Students' and Fleet's "Driver" columns/table cells are now purely read-derived from
`GET /assignments` client-side (new `isAssignmentActiveToday()` helper in `lib/format.ts`,
mirroring the exact "active today" range check `schedule.js`/`parentPortal.js` already use
server-side) — same single source of truth as the driver's own schedule, payroll, and the
parent dashboard's vehicle/driver display.

**Verification**: `npx tsc -b` and lint clean. Full backend suite: **269/269 passing**
across all 11 suites (removed/rewrote the now-invalid standalone-tag assertions in
`04-resources.test.cjs`, migration count bumped to 17). Live-verified the display fix
directly: Emma Johnson's real assignment (driver Sarah Jenkins) now shows correctly and
identically on both the Students page and the Fleet page (VAN-084), sourced from the one
real `assignments` row — previously these could have silently disagreed. The live
create/close/reopen round-trip (Students-page edit → real Assignment created → closed on a
second edit) was verified directly against the real API rather than through the browser,
after `StateAutocomplete`'s existing quirk under browser automation (typing doesn't open its
suggestion list via synthetic JS events — a pre-existing component behavior, not something
this change touched) made a full UI click-through impractical; a leftover test assignment
from that verification was deleted afterward.

## 2026-08-27 (latest) — Driver address/license fields, permanent passwords, student-driver link

Three page tasks from Anas, screenshots of the live Drivers/Students pages included for
reference (already my own earlier work, confirming those pages were live and working):

1. **Driver page**: added `address` and `license_number` (both optional text, new columns
   on `users`) to the Add Driver form and `EditAccountModal` (shown only when editing a
   `driver`-role account). Relabeled the password field from "Temporary password" to
   "Password" — fixed the same wording on the Parents and Staff & Access forms too for
   consistency, since leaving it inconsistent would read as those roles working
   differently when they don't. **Confirmed, not just assumed**: there is no forced
   first-login password-change mechanism anywhere in this app (no such flag on `users`, no
   reset-on-first-login code path) — the password an admin sets here already was, and
   remains, a real permanent password.
2. **Students page**: `students.driver_user_id` (new nullable column + composite FK to
   `users(id, company_id)`), optional at creation, editable after. New "Driver" column on
   the All Students table (same loading/"(no driver assigned)" fallback pattern as
   `AssignmentsPage`'s earlier UUID-display fix).
   **ASSUMPTION, flagged for confirmation**: implemented as a direct, simple tag on the
   student record — mirroring the exact pattern already shipped and approved for
   `vans.driver_user_id` (migration 013) — deliberately SEPARATE from the operational
   `assignments` table, which stays authoritative for actual daily scheduling, the driver's
   own schedule view, payroll, and the parent dashboard's vehicle/driver display. If a
   student's `driver_user_id` here and their real `assignments` row ever point at different
   drivers, that's an expected possibility of two independent fields, not a bug — flagging
   this explicitly since it's the one part of this task that wasn't fully unambiguous, and
   the precedent-matching call was mine to make.

**Verification**: `npx tsc -b` and lint clean. New backend test coverage in
`04-resources.test.cjs` (address/license create+edit, optional driver_user_id at creation,
cross-company FK rejection, patch-to-assign). Live-verified in the browser: Drivers page
shows the new fields with correct labels; Students page shows the new dropdown (optional)
and column; confirmed via direct API + DB check that `POST/PATCH /students` correctly
accept/reject `driver_user_id` cross-company. (One live UI click-through of assigning a
driver via the Edit Student form hit a pre-existing StateAutocomplete quirk under browser
automation, unrelated to this change — the underlying feature is covered by passing backend
tests either way.)

## 2026-08-27 (even later) — Parent Dashboard restyled from a real Stitch reference

Mid-turn, Anas sent an actual Stitch HTML export (unlike the two earlier "attached
screenshot" mentions that never came through) with explicit direction: adapt it, don't
clone it, and ask if anything's unclear. Asked 4 clarifying questions before touching
styling (map hero, fake ETA number, multi-student layout, nav structure) since guessing
wrong on a from-reference visual redesign wastes real effort. Answers:

1. **Map hero**: keep as a static/decorative placeholder for now — Anas explicitly framed
   live GPS as a V2 item for the whole app, not just this page. Built as a pure-CSS grid
   pattern + a decorative pulsing bus marker (no external map imagery hotlinked from the
   Stitch export's own placeholder photo URLs, which aren't ours to embed).
2. **"5 mins away" ETA**: Anas explicitly said keep the fake number for now, note it for V2
   once real GPS exists. Done — `StatusCard` only shows it when status is "In Transit",
   clearly code-commented as a fixed placeholder, not derived from anything real.
3. **Multiple students**: tab/pill switcher (his choice) — one student's full view at a
   time, replacing the earlier stacked-sections approach.
4. **Nav structure**: build the reference's own top-bar + bottom-tab-bar shell (his choice),
   not the shared `AdminLayout` sidebar every other role uses. New `ParentLayout.tsx`,
   parent-only. Tabs are real destinations only (Students, Profile) — did not copy the
   reference's "Route"/"Incidents" tabs since those aren't real features in this app.

Everything real stayed real and unchanged: vehicle info, driver contact, trip timeline
(restyled to the reference's vertical-line/checkmark language, not its data). "Skip Today's
Pickup" relabeled "Report Absence" to match the reference's wording — same backend logic.
New `ParentProfilePage.tsx` for the Profile tab (read-only, matches the earlier mockup's
profile section).

**Verification**: `npx tsc -b` and lint clean. Live-verified: student tab switcher, Profile
tab navigation, and all real data (Emma's real vehicle/driver/timeline, Liam's real "no
assignment" fallback) confirmed working end-to-end against the real dummy parent account.
No backend changes this pass.

## 2026-08-27 (latest) — Mockup removed, real Parent Dashboard built out, dummy account added

Anas caught that `/mockup/parent-dashboard` was live and unauthenticated on the public
deployed site (`saferoute-tms-client.onrender.com`) — pushed earlier in this engagement
without remembering to gate/remove it first. Fixed in two parts, first part pushed
immediately on its own given the exposure:

1. **Removed the mockup entirely** (commit `5a5ea34`, pushed standalone before anything
   else in this entry): deleted the route from `App.tsx` and the file
   `client/src/mockups/parent-dashboard/ParentDashboardMockup.tsx`. Verified live on the
   public site afterward — the URL now falls through to the login redirect, not the mockup.
2. **Real `/parent` page now shows what the mockup used to fake.** New
   `GET /parent/students/:id/detail` (`services/parentPortal.js`) returns real vehicle info
   (plate/brand/model/year/color from the student's current assignment's van), the assigned
   driver (name/phone), and today's real trips (from the `trips` table) for a real
   checkmark/current/upcoming timeline — same visual language as the old mockup, but every
   value is now real, not fake. `ParentHomePage.tsx` rewritten to render it: vehicle info
   grid, trip timeline, a real Contact Driver `tel:` link, the Skip Today's Pickup button
   (unchanged, already real), and the same static school↔home route illustration with its
   `TODO (v2): live GPS` comment carried over.
   **Real bug caught while building this and fixed before it shipped**: the new endpoint's
   `skip_today` flag was first wired to the assignment's schedule-override skip flag
   (driver/admin-set) instead of checking `pickup_skips` (the parent's own real Skip Pickup
   action) — meaning after a parent skipped, the dashboard wouldn't have reflected it. Caught
   by the endpoint's own test assertion failing, fixed to check both signals (`skip_today` =
   parent-skipped OR admin schedule-override skip).
3. **Dummy parent account created**, same pattern as the existing dummy driver/admin
   accounts (`admin@3bees.test`, `driver1@3bees.test`, etc.):
   - `parent1@3bees.test` / `Secret123!`, full name "Taylor Johnson", linked to **Emma
     Johnson** (the student with the most complete dummy data already — a real assignment,
     driver, van, and trip history; Liam Carter by contrast has no assignment at all, so
     wasn't a good demo case). Filled in a few previously-null fields on that existing dummy
     data to make the demo look complete rather than half-empty: Emma's assignment now has
     real `pickup_time`/`dropoff_time` (08:00/15:15), her van (`VAN-084`) now has a color
     ("White"), and her driver (Sarah Jenkins) now has a phone number ("555-0199") — none of
     this existed before, all of it real fields the app already supports, just never
     populated for this student.
   **Anomaly found and flagged, not silently fixed**: while setting this up, found a SECOND
   parent account already in the DB — `parent1@dummy.edu` / "SamaCrazy" — also linked to
   Emma Johnson, created via the same admin account (`admin@3bees.test`) a few minutes before
   this session created its own dummy account. Naming pattern (`dummy.edu`, "SamaCrazy") reads
   like manual human testing, not anything this session generated — almost certainly Anas
   testing the new Parents page himself on the live/shared dev DB after reading the earlier
   report. Left it alone rather than deleting or overwriting it, since it isn't this
   session's data to clean up. Worth deleting yourself if it was just a test.

**Verification**: `npx tsc -b` clean. Full backend suite: **250/250 passing** (248 from the
last entry + 2 more assertions extending `09-parent-and-permissions.test.cjs` for the new
detail endpoint, including the skip_today bug fix). Live-verified end-to-end: logged in as
the real `parent1@3bees.test` account in the browser, confirmed the real dashboard renders
Emma's real vehicle info (VAN-084, Ford, Transit SE, 2025, White), real driver (Sarah
Jenkins, `tel:555-0199` link works), a real trip timeline reflecting that no pickup has
actually been logged yet today (not fabricated as "done"), and Liam Carter correctly showing
"no driver/van assigned" rather than fake data.

## 2026-08-27 (later) — Fleet/Students/Payroll page enhancements

Third batch of edits from Anas, same "make reasonable assumptions, don't block" instruction.
Task said screenshots were attached for reference — **none actually reached this session**
(same gap as the Parent Dashboard mockup task) — built from the written spec plus the current
live UI/code instead. Flagging clearly, same as last time.

### 1. Fleet page

Migration `1752624000013`: `vans` gained `brand` (split from the old single `model` field —
both real vans in the dev DB had `model` populated, e.g. "Ford Transit SE", so brand/model
were backfilled by re-parsing on the first space rather than left blank — "Ford" / "Transit
SE"), `color`, and `driver_user_id` (a new *general* assigned-driver concept, distinct from
the existing per-student `assignments` table — a van now has one currently-assigned driver,
independent of which students that driver happens to be picking up). `license_plate`/`year`
made required (year already had real data on both vans, safe to enforce at the DB level
now). brand/model/year are DB `NOT NULL`; color/driver_user_id stay DB-nullable (no
historical data exists for either) but are required by `POST /vans` — same precedent this
project already established for company/school zip+state. `routes/vans.js` updated
accordingly, with a `driver_user_id`+`company_id` composite FK (mirrors the same
tenant-consistency pattern as `assignments`) so a cross-company driver assignment 400s.

`VansPage.tsx`: table gained Brand/Color/Driver columns (small Material icons in each header
for the visual-polish ask), Add/Edit form gained Brand+Model (split), Color, and a driver
dropdown, all required. Driver name resolved client-side via a small lookup map, same
per-column loading/fallback pattern already established on `AssignmentsPage.tsx`.

### 2. Students page

Migration `1752624000014`: dropped the old `address` column (both real students had it
NULL — nothing lost) and added `street_address`/`city`/`state`/`zip_code`. Every create-form
field except Notes is now required — enforced in `routes/students.js` (grade/age/parent
name+phone/street/city/state/zip all required on `POST /students`), reusing the existing
`assertValidZip`/`assertValidState` helpers (same validators companies/schools already use).
**ASSUMPTION**: like the van fields above, these new/tightened-required columns stay
DB-nullable — existing students (and grandfathered NULLs from before this change) aren't
retroactively forced to have every field filled in; "required" is enforced only at the point
of creating/editing through the form.

**"Add another parent/guardian"**: append-only rows of name+phone on the create form.
Explicitly NOT new parent login accounts, per the task's own clarification — the first row
becomes the student's existing primary contact fields (`parent_name`/`parent_phone`,
unchanged schema decision from the original build), and any additional rows become
`student_contacts` rows (already-existing table from the Driver dashboard rework), tagged
`"Parent/Guardian"`, created via the already-existing `POST /students/:id/contacts`
endpoint — no new backend capability needed for this part. **ASSUMPTION**: this multi-row UI
is create-only; editing an existing student still uses one primary-contact field pair plus
the separate "Contacts" panel already built below the table (which already covers editing
additional contacts) — didn't duplicate that UI into the edit form.

Table gained School (resolved via the existing `GET /schools` lookup, same pattern
`AssignmentsPage.tsx` and this page already use elsewhere) and Address (joined from the four
new fields) columns.

### 3. Payroll page

**Checked before building, per the task's explicit instruction**: driver work-time tracking
**already exists** — `sessions.check_in_at`/`check_out_at`/`duration_minutes`, already
computed into hours/days by `services/payroll.js`'s `summary()` and already surfaced on the
driver's own dashboard. This kept the task in the smaller-scope case: no new tracking
mechanism needed, just a way to mark a cycle settled and reuse the existing math for "since
when."

Migration `1752624000015`: `pay_rules.paid_through_at` (nullable timestamptz; NULL = never
paid). New `unpaidSummary()`/`markPaid()`/`listAdjustments()` in `services/payroll.js`, new
routes `GET /payroll/unpaid-summary/:driverId`, `POST /payroll/rules/:driverId/mark-paid`
(both company_admin-only), `GET /payroll/adjustments/:driverId` (self-or-admin, same gate as
the existing summary route).

**Real bug found and fixed while building this**: `summary()`'s adjustments were never
filtered by the `from`/`to` range at all — only sessions were. Every adjustment a driver ever
had recorded bled into every summary computed for them, including their own dashboard's
"This Month's Pay" card (which does pass a month-scoped `from`/`to`) and would have made the
new "amount owed since last paid" silently wrong (already-settled adjustments reappearing as
still owed, forever). Fixed by filtering `pay_adjustments` by `work_date` exactly like
sessions are filtered by `check_in_at`. Regression-tested explicitly (see below) — this
wasn't a hypothetical, a real adjustment from months-old data was still bleeding into a
`from=2025-01-01` query before the fix.

`PayrollPage.tsx`: Driver Pay Rates table gained Worked This Cycle (days or hours, matching
`rate_type`) and Amount Owed columns, computed per-driver via the new unpaid-summary
endpoint. A driver's name is clickable (when they have a rate set) and opens a modal listing
every shift and adjustment in the current unpaid cycle, sourced from the already-fetched
`/sessions` + the new adjustments endpoint, filtered client-side by the cycle boundary. A
"Paid" button per driver calls mark-paid and the row updates live (verified with an explicit
wait — an instant re-check right after the click can catch React Query's invalidation
mid-flight and look stale; it is not, confirmed by re-checking after ~1.5s and by a full page
reload landing on the same up-to-date numbers).

**Verification**: `npx tsc -b` and `npm run lint` clean (client). Full backend suite:
**248/248 passing** across all 11 suites, including a new `server/test/11-payroll-paid.test.cjs`
(12 assertions, covering the unpaid-summary/mark-paid flow, the adjustments-date-filter bug fix
explicitly, and permission gates). Updated `01-schema.test.cjs`'s migration count and several
existing tests' van/student payloads for the new required fields (04-resources, 02-auth-rbac,
09-parent-and-permissions, 10-no-show — all were creating vans/students with the old minimal
shape, which now 400s or violates a NOT NULL constraint).

Live-verified end-to-end against the real dev Neon DB, not just the isolated suite: created a
real test van with brand/color/driver through the actual Fleet UI, created a real student
with two guardians (one primary + one via "Add another parent/guardian") through the actual
Students UI and confirmed the second one landed as a real `student_contacts` row, and
exercised the real Payroll "Paid" button against Marcus Rodriguez's real historical pay data
(3 days / $415.00 owed, matching real sessions + adjustments going back to July) — confirmed
the click correctly zeroed the cycle live, then **reverted `paid_through_at` back to NULL
afterward** via direct SQL so his real payroll state wasn't left altered by this session's
testing. Deleted the test van and test student afterward too.

## 2026-08-27 — Company nav restructuring (Driver/Parent pages) + driver-side no-show feature

Follow-up to the parent-role session below. Anas was looking at the *deployed* site
(`saferoute-tms-client.onrender.com`) and correctly noted "Add Parent" wasn't there — that's
expected, the previous session's work was never pushed (flagged again here since it's easy
to lose track of: everything in this file is still local/uncommitted as of this entry too).

Before building, asked 4 clarifying questions (explicitly invited — "ask me any questions if
you have any") since the request implied a real Dashboard redesign that wasn't otherwise
specified. Answers, and what they changed about the plan:

1. **"Absent students" definition** — Anas's answer surfaced a whole feature, not just a
   definition: parents already have Skip Pickup (previous session); he wants the *driver*
   side too — "whenever they arrive and no one shows up they can hit the button the student
   is Absent" and it should notify the school + company. Built it (see below) — his framing
   ("that is a very good feature we should add") made this a real go-ahead, not a hypothetical.
2. **Dashboard scope** — "others... do not wanna confuse you with too much details... when
   we are done with the rest we are coming back to it." So the Dashboard itself was
   deliberately NOT redesigned this session — see below for what it looks like now.
3. **Parent linking after creation** — "Yes, full link/unlink management" — built as a real
   page (mirrors school_admin's Staff & Access exactly), not just at-creation linking.
4. **Account editing** — "Yes, add edit capability" — built a shared edit modal (password/
   email/profile/deactivate), giving the previous session's creator-only-edit permission work
   an actual UI for the first time.

**Nav restructuring**: `client/src/App.tsx`'s `COMPANY_NAV`, exact order per Anas's own
words — Dashboard, Driver, Fleet, Students, Parents, Assignments, Payroll.

**New: `client/src/pages/company/DriversPage.tsx`** — the "Live Driver Status" table and
"Add Driver" form that used to live on the Dashboard, moved here wholesale, plus a new Edit
button per driver opening the shared modal.

**New: `client/src/pages/company/ParentsPage.tsx`** — mirrors `StaffAccessPage.tsx`'s
two-column pattern (create + list on the left, selected-parent's student-access checklist on
the right), but for `parent_user_id`/`/parent-access` instead of `staff_user_id`/
`/staff-access`. Add Parent form moved here from the Dashboard (dropped the at-creation
student-checklist that briefly lived on the Dashboard's combined Add Driver/Parent card, in
favor of this fuller page). Edit button per parent, same shared modal.

**New: `client/src/components/EditAccountModal.tsx`** — shared by both pages. `PATCH
/users/:id` with full_name/phone/email/is_active/password (password optional, blank = keep
current). Surfaces the backend's 403 ("only the creator can edit") as a real, legible message
instead of a generic error.

**Dashboard (`CompanyAdminDashboard.tsx`)**: stripped down, not redesigned. Removed the
"Live Driver Status" table and "Add Driver or Parent" card (both moved to their own pages).
Left Fleet and Payroll Summary as-is for now, plus a one-line note that a real overview is
coming — per Anas's own "come back to it later" instruction, this is a deliberate half-step,
not a finished redesign.

**New real feature: driver-reported no-shows.** Migration `1752624000012`: `pickup_no_shows`
table, same shape as `pickup_skips` (unique on student+date, doubling as the double-submit
guard). `services/schedule.js`'s new `markNoShow()` — requires an open shift (same invariant
`logTrip` already enforces), 404s if the assignment isn't the calling driver's own, 409s on a
same-day duplicate report. Notifies company_admins + school_admins via a newly-extracted
shared helper, `services/notifications.js`'s `notifyCompanyAndSchoolAdmins()` — pulled out of
`parentPortal.js`'s Skip Pickup notify logic once a second feature needed the identical
"company + school admin" recipient lookup, rather than duplicating it. `parentPortal.js`
refactored to use the shared helper too; its own test suite (09) still passes unchanged,
confirming the refactor didn't alter its recipient set.

`getTodaySchedule()` (the driver's daily schedule) now also returns `parent_skipped_today`/
`no_show_reported_today` per item (two cheap extra `LEFT JOIN`s) — lets the Driver dashboard
show "parent already skipped this pickup" and reflect an already-reported no-show without a
second round-trip. New route: `POST /schedule/:assignmentId/no-show`, driver-only.

**Driver dashboard UI**: new "Mark Absent" button next to the existing pickup/dropoff
Confirm control (pickup-only — a no-show is specifically about arriving to an empty pickup),
disabled until checked in, already-logged-today, already-reported, or parent-already-skipped.
Shows a note when the parent already skipped so the driver knows not to bother.

**Tests**: `server/test/10-no-show.test.cjs` (8 assertions) — open-shift requirement,
ownership (wrong driver's assignment → 404), non-driver role → 403, the notify + double-
submit-guard flow, and `getTodaySchedule`'s new fields. `01-schema.test.cjs`'s migration
count bumped 11 → 12.

**Verification**: `npx tsc -b` and `npm run lint` clean (client). Full backend suite:
**233/233 passing** (223 from the previous session's work + 10 new). Live-verified end-to-end
against the real dev Neon DB, not just the isolated suite: created a real test parent via the
new Parents page, linked/unlinked Emma Johnson through the real checklist UI, edited a real
driver's account (Marcus Rodriguez, a grandfathered NULL-creator row — confirmed any
same-tenant admin can still edit it) via the new modal, then logged in as `driver2@3bees.test`
(Sarah Jenkins, Emma's real assigned driver), checked in for real, clicked the real "Mark
Absent" button, and confirmed via the API server's own console that two real `[mail]` lines
went out — to `admin@3bees.test` and `principal@willowcreek.test` — with the expected
subject/body. Cleaned up every test artifact afterward (test parent account, the no-show row,
and the test check-in/out session).

**Note on the Windows embedded-Postgres flake from the previous session**: traced to 7
orphaned `postgres.exe` processes left over from earlier overlapping test invocations,
holding a stale shared-memory segment (`FATAL: pre-existing shared memory block is still in
use` — the exact hint Postgres itself printed: "check for old server processes and terminate
them"). Found via `tasklist` (not visible to a plain `ps aux` from Git Bash), killed via
`taskkill`, and the suite ran clean immediately after. Not a code issue; recorded here in case
a future session hits the same symptom.

## 2026-08-25 (even later) — Parent role + account permissions (real) + Parent Dashboard mockup

Two-part task from Anas, run autonomously while he was away ~1hr with instructions to make
reasonable assumptions rather than block. Both parts done; several assumptions flagged below
for his confirmation.

### Part 1 — real backend + permission changes

1. **New `parent` role.** Migration `1752624000011`: `parent` added to `users_role_check` and
   grouped with `driver`/`company_admin` in `users_tenant_scope_check` (company-scoped, since
   company_admin creates parent accounts). New `parent_students` join table (many-to-many,
   composite tenant-consistency FKs mirroring `staff_student_access` exactly) so one parent
   can link to multiple students. New `server/src/routes/parentAccess.js` +
   `services/parentAccess.js` (`/parent-access`, company_admin-only grant/list/revoke).
2. **Narrowed CREATABLE.** `company_admin` can now create `driver`/`parent` only (previously
   also `company_admin` — **removed**, since the task's spec enumerated exactly two roles and
   didn't include company_admin's own). `school_admin` can now create `school_staff` only
   (previously also `school_admin` — same narrowing). Neither the app nor its tests
   previously depended on the removed self-creation ability, so nothing broke, but this is a
   **real behavior change worth Anas explicitly confirming** — it wasn't asked for in those
   words, it's what the enumerated lists implied.
3. **Creator-only edit.** New `users.created_by_user_id` column, stamped on every
   `POST /users` create. `PATCH /users/:id` (`services/users.js`) now 403s unless the caller
   is the account's creator. **ASSUMPTION**: rows with no recorded creator (every account
   that existed before this column — the seeded drivers/staff, Jamie, etc. — plus any future
   self-serve company_admin/school_admin signup, which has no creating admin) are
   grandfathered to "any same-tenant admin may edit," the old behavior, rather than
   uneditable by anyone. Locking those out entirely would have silently stranded real
   accounts with no edit path at all. Also extended `PATCH /users/:id` to accept `email` and
   `password` (previously only `full_name`/`phone`/`is_active` — there was no way to admin-
   edit an account's login credentials at all before this).
4. **No self-edit for driver/parent/school_staff.** Checked rather than assumed: no self-edit
   route for password/email existed anywhere in this codebase for any role before this task —
   nothing to remove. Explicitly tested now rather than left implicit.
5. **"Forgot password"** on `/login`, driver/parent/school_staff only. **ASSUMPTION, flagged
   for confirmation**: since this is one shared login page for all 5 roles and the app can't
   know a visitor's real role before they authenticate, "shown only for these 3 roles" can't
   be conditioned on their actual account — resolved by asking the visitor to self-report
   which of the three they are (fine, since no real reset action happens either way), then
   showing that role's static message. `/register` untouched, per instruction.
6. **Tests**: new `server/test/09-parent-and-permissions.test.cjs` (28 assertions) covering
   all of the above plus the skip-pickup flow below — narrowed CREATABLE, creator-only edit
   (including the grandfathered-NULL case and an actual password-change round-trip via
   re-login), parent<->student linking + tenant isolation, and the full skip/notify flow.
   `01-schema.test.cjs` updated for the new migration count + a positive/negative check on
   `parent`'s tenant-scope CHECK. Full suite: verify the tail of this session's own run before
   trusting "clean" — see the note at the end of this entry.

### Part 2 — Parent Dashboard: mockup (isolated) + one real feature (Skip Pickup)

The task explicitly carved the Skip Today's Pickup button out of "mockup, fake data only" —
it needs a genuine notification send. Built accordingly:

- **Real**: `server/src/services/parentPortal.js` + `routes/parentPortal.js`
  (`GET /parent/students`, `GET /parent/students/:id/skip-status`,
  `POST /parent/students/:id/skip-pickup`). Eligibility (available until 30 min before
  scheduled pickup, unavailable through the school day, resets daily) is computed
  server-side and authoritatively, from the student's real active assignment + today's
  schedule override, not trusted from the client. On confirm: inserts a `pickup_skips` row
  (unique per student/day, doubling as the double-submit guard) and calls the existing
  `sendMail()` — no new notification system — to every active company_admin, every active
  school_admin of the student's school, and the specific driver on today's assignment.
  **ASSUMPTION, flagged for confirmation**: the eligibility check compares `pickup_time`
  against the database's own session timezone (no per-school/per-company timezone concept),
  matching how `assignments.pickup_time` already worked pre-existing (a bare `time`, no tz) —
  not new imprecision, but worth knowing if company/school timezones ever diverge. Live-
  verified end-to-end against the real dev Neon DB (not just the isolated test suite):
  created a real parent account linked to the real Emma Johnson, temporarily set her real
  assignment's `pickup_time` to make the window eligible, called the real endpoint, and
  confirmed via the API server's own console that three real `[mail]` log lines went out —
  to `admin@3bees.test`, `principal@willowcreek.test`, and `driver2@3bees.test` (the real
  assigned driver) — with the expected subject/body. Reverted the assignment's `pickup_time`
  and deleted the test parent account + link + skip record afterward.
- **Real, minimal**: `client/src/pages/parent/ParentHomePage.tsx`, wired as the real `parent`
  role's actual login landing page (`ROLE_HOME.parent = '/parent'`) — real linked students,
  real working Skip button. Not styled/designed yet; exists so a real parent login has
  somewhere real to land, separate from the mockup below.
- **Mockup, isolated**: `client/src/mockups/parent-dashboard/ParentDashboardMockup.tsx` — the
  fully-described layout (per-student vehicle info/plate/year/model/color, company name,
  "In Transit, X mins away" status, checkmark/dot/greyed trip timeline, static school-to-home
  route map with a `TODO: live GPS (v2)` comment, Contact Driver as a `tel:` link, read-only
  username-only profile section). All fake/hardcoded data, matching the task's "no real
  db/api calls" instruction for everything except the Skip button (which reuses the real
  logic above — its eligibility math runs against the real wall clock, not a fake one, and
  its Confirm action calls the real endpoint if a real parent session/student id is
  supplied). Not imported by `App.tsx`'s real route tree; reachable only via a **temporary**
  unauthenticated `/mockup/parent-dashboard` route added for design review — **remove that
  route before any real deploy**. **ASSUMPTION, flagged prominently**: no reference image
  actually reached this session — the task said one was attached, but nothing came through.
  Built from the written spec plus this codebase's existing "Road & Logistics" design system
  (same `Card`/`Button`/`StatusBadge` components and `index.css` tokens every real page
  already uses) for visual consistency. **Please compare against the real Stitch export when
  you're back** — this is a best-effort reconstruction from text alone, not a verified match.
- Frontend real wiring: `types/api.ts` gained `Role`'s `'parent'` variant,
  `PublicUser.created_by_user_id`, `ParentStudentLink`, `SkipStatus`.
  `CompanyAdminDashboard.tsx`'s "Add Driver" card became "Add Driver or Parent" (role
  toggle + a student-link checklist show when Parent is selected) — needed so the new
  backend capability is actually usable from the UI, not just via raw API calls; not asked
  for explicitly but the permission change would otherwise have no UI path at all.

**Verification**: `npx tsc -b` clean, `npm run lint` clean (client). Backend suite run
started before this entry was written — **check its tail before trusting "all green"**;
two unrelated flakes were hit and resolved earlier in this session (06-staff-access failing
once from a stale embedded-Postgres shared-memory lock caused by two overlapping local test
invocations — passed cleanly alone afterward — and 01-schema's hardcoded migration count,
legitimately updated from 10 to 11). Live-verified against the real dev Neon DB as described
above, with all test artifacts cleaned up afterward (matching this project's own established
convention for live-verification sessions).

## 2026-08-25 (later still) — Assignments UUID display fix + multi-tab session bug fixed

Two items from a `TMS_GAP_ANALYSIS.md` Anas referenced (produced via Claude in Chrome).
**That file does not exist anywhere in this repo** — checked a fresh `git fetch` (no new
commits on `origin/main` beyond this session's own) and the working tree directly; not
acted on as a trusted source, same reasoning as the spec-file mixup earlier today. Anas's
own chat message described both bugs specifically enough to act on directly regardless.

**1. Assignments page raw-UUID display — was NOT already fixed, despite being described
that way.** Checked `client/src/pages/company/AssignmentsPage.tsx` directly: the fallback
was still `studentsById.get(a.student_id)?.full_name ?? a.student_id` (and the equivalent
for driver/van) — a raw UUID would render whenever the join-target query hadn't resolved
yet, exactly the bug described, completely unfixed. Implemented it directly: each cell now
checks its own query's `isLoading` first (`'…'` while pending) and falls back to
`'(deleted student/driver/van)'` only once that query has actually resolved and the id
still isn't in the map. `npx tsc -b` clean.

Verified live, not just read: ran `npm run dev` (api+client), logged in as
`admin@3bees.test`. The DB's own composite FKs (`assignments_student_company_fk` etc., no
`ON DELETE` override, so default `RESTRICT`) mean a referenced student/driver/van can't
actually be deleted while an assignment points at it — so both scenarios were reproduced
by temporarily patching `api.ts` (delay real fetches to `/students`/`/users`/`/vans`
behind a `localStorage` flag for the loading race; filter a driver out of the `/users`
response behind a second flag for the not-found case), confirmed the exact expected
render in each case, then fully reverted `api.ts` (`git checkout --`, diff confirmed
empty) before committing anything. Loading race: row rendered `… / … / …` for
student/driver/van while the real assignment date/buttons were already visible, then
resolved cleanly to `Emma Johnson / Sarah Jenkins / VAN-084`. Not-found case: with Sarah
Jenkins filtered out of the drivers response, the row rendered `Emma Johnson / (deleted
driver) / VAN-084` — student and van still resolved correctly, confirming the fallback is
per-column, not an all-or-nothing failure.

**2. Multi-tab session confusion — real bug, fixed.** `client/src/lib/auth.tsx`'s
`AuthProvider` read `localStorage` once on mount and never again; nothing listened for
another tab changing `saferoute_token`/`saferoute_user`. Added a `storage` event listener
(native browser event, fires only in *other* tabs of the same origin when either key
actually changes value) that does a full `window.location.reload()` — deliberately a full
reload rather than just re-syncing the auth state in place, since this tab's in-memory
React Query cache could otherwise keep serving data fetched under the old account after
the auth context itself updated.

Verified live across two real tabs, both directions: logged into tab A as
`admin@3bees.test` (Company Admin dashboard), then logged into tab B as
`driver1@3bees.test` — tab A automatically flipped to the Driver dashboard (confirmed via
its own sidebar: "Driver Portal", `driver1@3bees.test`, "Marcus Rodriguez") with no manual
action on tab A at all. Then logged out from tab B — tab A automatically redirected to
`/login`. Re-ran the whole sequence a second time from fully fresh tabs with zero
interleaved file edits (an earlier pass showed transient `useAuth must be used within
AuthProvider` console errors that turned out to be Vite HMR noise from editing `api.ts`
live in the same browser session for item 1's test, not a real defect — the clean re-run
had zero console errors in either tab). `npx tsc -b` clean.

## 2026-08-25 (later same day) — company_admin management UI: already built, not a gap

Anas asked for van/assignment/payroll-rules/student-creation management UI for
company_admin, per `TMS_PROJECT_SPEC_1.md` §8's "not built yet" list, while away for ~2
hours. Before writing any code: checked `client/src/pages/company/` and found all four
already exist, fully built, and already wired into `App.tsx`'s routes and the sidebar nav —
`VansPage.tsx` (create/edit/delete), `AssignmentsPage.tsx` (create/end/delete + inline
pickup/dropoff time edit + a full schedule-overrides sub-panel), `PayrollPage.tsx` (set
rate + add adjustment), `StudentsPage.tsx` (create with existing-school-or-new-placeholder
choice + edit + a contacts sub-panel). §8 had simply gone stale relative to §7's own route
table, which already listed these correctly as built management pages.

Rather than build duplicate pages (which would have created dead/confusing code against an
already-working feature), verified each one live against the real dev Neon DB through the
actual running app, not just a code read: logged in as `admin@3bees.test` against `npm run
dev` (api + client), and for each page did a real create round-trip through the UI —
add a van, add a student (new "Test Verify Student" under Willow Creek Elementary), add an
assignment (Liam Carter → Marcus Rodriguez → VAN-1109), set Marcus Rodriguez's pay rate
(re-saved his existing $125/day, idempotent), and added a $0.01 adjustment immediately
offset by a -$0.01 adjustment (adjustments are append-only by design, no delete endpoint —
net financial effect on Marcus's pay is exactly zero, both adjustments clearly noted
"frontend-verify test" for anyone who looks). Cleaned up everything reversible afterward:
deleted the test van and test assignment through their own UI Delete buttons; the test
student had to be deleted via a direct authenticated `DELETE /students/:id` API call since
the Students page has no delete button (see gap below) — confirmed 204. No server errors,
no console errors, across the whole sweep.

**Gap actually found, not previously tracked anywhere:** `DELETE /students/:id` exists and
works on the backend (`company_admin`-scoped, tested indirectly just now via direct API
call) but `StudentsPage.tsx` has no delete button — only Edit and a Contacts sub-panel.
Unclear whether that's deliberate (e.g. avoiding accidental deletion of a student with real
trip/assignment history) or just missed when the page was built. Worth a decision from
Anas, not fixed here since it wasn't what was asked for and the intent isn't obvious either
way.

Updated `TMS_PROJECT_SPEC_1.md` §8 to drop the two stale "not built" bullets (van/
assignment/payroll UI, student creation UI) and added a §12 changelog entry with this
correction, plus one for the `JWT_SECRET` rotation Anas did directly in Render's dashboard
earlier the same day (reported by him via chat, not independently verified by this session
since it has no Render env-var access — recorded as reported, not confirmed).

See `NEXT_STEPS.md` (new, repo root) for the Render env-var checklist this session was
explicitly told not to act on itself (SMTP credentials, `sslmode=verify-full`).

## 2026-08-25 — Safety pass ahead of real company data (3 Bees Transportation) going live

Three items from a prep session Anas ran with Claude (chat), implemented and verified in
this session, not just written:

1. **`server/src/config.js`** now throws a clear error at boot if `JWT_SECRET` or
   `DATABASE_URL` are missing under `NODE_ENV=production`, instead of silently falling back
   to the insecure dev default (`'dev-insecure-change-me'`). Dev/test behavior unchanged
   (still falls back, since the check only runs for `production`). New
   `test/08-boot-safety.test.cjs` (spawns child processes across prod/dev/test ×
   present/missing combinations) covers this.
2. **`server/src/mail/mailer.js`** now supports real SMTP sending via `nodemailer`
   (`^9.0.5` — see the new backlog item below on why not `^6.x`), auto-activated when
   `SMTP_HOST` is set in env. `NODE_ENV=test` always uses the existing dev transport
   regardless of SMTP config, so the suite never depends on network access; verified by the
   same new test file (mocks `SMTP_HOST` under `NODE_ENV=test`, confirms no real network
   attempt is made and the message still lands in `_sent()`). Intended provider: Resend, via
   its SMTP endpoint.
3. **`.github/workflows/db-backup.yml`** — daily `pg_dump` (custom format) of the live Neon
   DB, via a `postgres:18` Docker image so the client version matches Neon's server version
   (18.x) rather than whatever ubuntu-latest ships. Uploaded as a 90-day workflow artifact;
   also runs on `workflow_dispatch` for manual triggers. Needs a `DATABASE_URL` repo secret
   (Anas sets this himself in GitHub settings — not in any file). New
   `server/BACKUP_RESTORE.md` documents setup, manual runs, downloading artifacts, and
   restoring via `pg_restore` (into a scratch DB first, not live, unless deliberately
   recovering).

Full suite re-run clean after these changes: **193/193 passed** (well above the 140+ bar),
one single clean run after clearing stale embedded-Postgres locks left over from an earlier
run that collided with itself.

**Live verification, with real evidence:** after pushing, `saferoute-tms-api`'s Render
dashboard (viewed read-only via the user's own already-logged-in session — no credentials
entered) showed the new commit auto-deployed and went live via a plain `git push`, no
manual trigger needed — this also resolves a previously-open item: push-based auto-deploy
to `main` was flagged as broken as of the 2026-07-20 session and now genuinely works.
Since the deploy went live rather than crash-looping, and `/health` still returned
`{"status":"ok"}` afterward, this is direct evidence the new production boot-guard didn't
trip — Render already has real `JWT_SECRET`/`DATABASE_URL` set. Full detail in
`PROJECT_STATE.md`'s matching addendum.

**What this entry does NOT cover — deliberately left to Anas, not something an AI assistant
should do on someone's behalf:** entering the actual Resend API key (as `SMTP_PASS`) and
the other SMTP env vars into Render's dashboard. Entering API keys/credentials into
third-party account settings is out of scope regardless of instruction. Once Anas sets
those, a follow-up session can trigger a real send against the now-live SMTP code path and
confirm delivery — not done yet.

**Correction to an earlier finding in this same session, worth recording plainly:** this
session initially reported `TMS_PROJECT_SPEC_1.md` as missing from the repo entirely,
including from git history (`git log --all` for it), and proceeded on `PROJECT_STATE.md` +
`BACKLOG.md` + current code with Anas's go-ahead. That check was run against a stale local
clone without fetching first — the file was in fact created on GitHub at 10:42/10:54 EDT
that same morning (`0bc54e6`/`41a5a58`, "Create/Fix indentation in TMS_PROJECT_SPEC_1.md"),
before this session's check ran, but this session's local `origin/main` ref hadn't been
fetched since before that, so it looked absent both on disk and in local git history. It
only surfaced when `git push` was rejected for being behind and a `git fetch` pulled it in.
Net effect: the file genuinely does now exist (see the repo root) and this session's
earlier claim to Anas that it didn't was based on an incomplete check, not a correct one —
flagging the gap in method, not just the wrong intermediate conclusion.

## 2026-07-23 — Driver dashboard rework: real daily schedule, student/school detail, pay visibility

Driver's dashboard now shares the same sidebar shell (`AdminLayout`) as the other 3 roles —
`DriverLayout.tsx` is deleted (not parked; this one was a straight replacement, not a
"might need it later" decision).

New "Today's Schedule" (`GET /schedule/today`, driver-only) replaces the old free-form
"pick any student, log a trip" form: shows each of a driver's currently-active assignments
with the student's usual pickup/dropoff time, a Pickup/Drop-off toggle (a status marker
only), and a Confirm action that calls the existing `POST /trips` unchanged. A one-off
per-date "schedule override" (`assignment_schedule_overrides`, one row per assignment+date)
is the only exception mechanism built now — a full recurring weekly pattern is explicitly
V2. An overridden time renders in red on the driver's view; `skip: true` shows "No
pickup/dropoff today" instead.

Clicking a student name opens a detail modal: parent info, new `age`/`address`/`notes`
fields, additional contacts (new `student_contacts` table — the primary contact stays on
`students.parent_name/parent_phone` per migration 004's original decision; this is for
*additional* contacts beyond that one), and a month calendar of **actual trip history**
(derived client-side from the driver's already-fetched trips, not a new endpoint). Clicking
a school name opens a similar modal (new `phone`/`hours`/`website` columns on `schools`,
read via a new `GET /schools/:id` scoped the same way as the existing company_admin-only
`GET /schools` — only reachable for a school the caller's company has a student at).

Check-in now also shows a pay-rate-aware "This Month" card (hours+pay if hourly, days-only+
pay if daily, via the existing `GET /payroll/summary/:driverId`) and a "Worked this month"
calendar (from the already-fetched sessions, no new endpoint).

New admin surfaces to actually populate the above: student create/edit gained the new
fields plus a contacts manager (`CompanyStudentsPage`, previously create-only); assignments
gained inline time editing and an overrides manager (`AssignmentsPage`); a brand-new
`SchoolProfilePage` (`/school-admin/profile`) lets school_admin edit their own org's info at
all for the first time — previously not even the address set at claim time was editable.

Migration `1752624000010`. Scope boundary: this doesn't touch the placeholder-creation
flow (`placeholders.js`) — that's still free-text address only.

## 2026-07-21 — Registration rework: claim flow parked, new required fields, password rules

Per direct request: `/register`'s "Create new" / "Claim existing" mode toggle is hidden
(`CLAIM_FLOW_ENABLED = false` in `RegisterPage.tsx`) — self-serve registration now only
creates brand-new orgs, no toggle shown. The claim/email-verification backend
(`signupClaim`, `verifyEmail`, `resendVerification`, `searchClaimable`) and the frontend's
claim-search UI and "check your email" screen are **not deleted**, just unreachable — flip
the flag back if this is needed again. Since the only reachable path (`signupFresh`)
already stamped `email_verified_at` immediately with no verification step, this also
satisfies "no verification required for a new org" with zero new bypass logic — that
behavior already existed, hiding the claim path was the only change needed.

New required fields on fresh org signup: `address` (was optional, now required), plus two
new fields, `zip` and `state` (validated as a real 2-letter US state code, normalized to
uppercase). New nullable `zip_code`/`state` columns on `companies`/`schools`
(migration `1752624000009`). `placeholders.js` (the Add-a-Company/Add-a-School flow inside
the dashboards) is unchanged — still free-text address only, deliberately out of scope.

Password complexity tightened: min 8 chars **and** at least one uppercase, one lowercase,
one special character (`assertPasswordStrength` in `validate.js`). Frontend adds a
show/hide toggle, a live strength meter (Weak/Fair/Good), the rules as visible text under
the field, and a confirm-password field with a client-side match check.

## Known-broken (tracked as of July 18 2026)
1. [RESOLVED July 19 2026 — see commits `e1dba8d`, `c330c08`] Registration "hangs" on
   "Submitting" for the *"Create new" org* path (not the claim path — see #2, untouched).
   Root cause (from the prior investigation session): `RegisterPage.tsx`'s `onSuccess`
   chains `signup -> login -> navigate` under one mutation, so `submit.isPending` (and the
   button) stays busy for the whole chain, not just the signup call — measured ~7.4s warm,
   with Render free-tier cold starts able to stretch that past a minute, all behind one
   static "Submitting…" label with zero differentiated feedback. Not a deadlock — a
   latency + UX-feedback gap. Fix: added a `stage` state (`'creating' | 'logging-in' |
   'loading-dashboard'`) giving each leg its own button label ("Creating your account…" /
   "Logging you in…" / "Loading your dashboard…"), plus a `showColdStartHint` reassurance
   message ("First request may take up to a minute while the server wakes up…") if the
   whole submit is still pending past ~9s. Signup/login/navigate sequencing itself is
   unchanged, per the task's own constraint.
   **Caught and fixed a real regression the fix itself introduced, before this session
   closed**: the first version used `requestAnimationFrame` to let React paint the
   "loading-dashboard" label for one frame before `navigate()`. Verified live that `rAF`
   callbacks never fire at all in a backgrounded/non-visible browser tab — confirmed
   directly (scheduled one, it never ran) — which meant a fully successful registration
   would hang forever on "Loading your dashboard…", never navigating: the exact class of
   bug this fix exists to solve, reintroduced by the fix. Swapped to `setTimeout(resolve,
   0)`, confirmed to always fire in the same live test, then re-verified the full flow
   end-to-end.
   **Verified live** (twice, against the real deployed backend/Neon DB, via a
   `MutationObserver` on the submit button capturing every label change with timestamps):
   run 1 (naturally slow/cold) showed all three stages in order plus the cold-start hint,
   then hung forever on "Loading your dashboard…" — that was the rAF bug, caught here, not
   shipped as the final state. Run 2, after the `setTimeout` fix, showed all three stages
   in order (~3.4s signup, ~2.4s login) with no cold-start hint needed (under 9s), then
   correctly landed on `/company` with the new company_admin logged in and the dashboard's
   real (empty, brand-new-org) data rendered — no functional regression. Test accounts/
   companies from both verification runs deleted directly from Neon afterward.
2. [INVESTIGATED July 19 2026 — no code bug found] Email verification. Reproduced the full
   pipeline live end-to-end against the real deployed backend and Neon DB: created a
   school placeholder → claimed it via `/register` (kind=school, claiming) → confirmed via
   Render's live app logs that the dev-mailer actually logged the verification email
   (`[mail] to=... | Verify your email...`) with a real, working token → visited
   `/verify-email?token=...` → got "Email verified / Your claim is confirmed and your
   account is now active" → logged in successfully as the new school_admin, correctly
   scoped to that school. Also confirmed the token is properly single-use: revisiting the
   same link afterward correctly showed "Verification failed / invalid or expired token"
   with a working resend form. The "Phase 4 StrictMode/useMutation fix" this session's
   task prompt referenced *is* real — it's documented in `VerifyEmailPage.tsx`'s own
   comment (the `useQuery`-keyed-by-token pattern, not a `useMutation` fired from a
   `useEffect`) — and it holds up correctly on this fresh live re-test; not a regression.
   **The actual reason a real end-user can't verify on the live deployment**: there is no
   real email transport (already tracked below, "Real email transport"). The verification
   token only ever appears in Render's private server console logs — a real person
   registering on the public live site has no way to see it. This isn't a code defect to
   fix; it's the pre-existing, already-known email-transport gap manifesting as "doesn't
   work" from a real user's point of view. No code change made — nothing was broken to fix.
   **Unrelated issue noticed while investigating** (not fixed, flagging only): every
   request logs an `express-rate-limit` `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` warning in
   production — Render sits behind a proxy and sets `X-Forwarded-For`, but the Express app
   never calls `app.set('trust proxy', ...)`. Confirmed non-fatal (didn't block any request
   in this session's testing) but worth fixing since it also means the rate limiter may be
   keying on the wrong IP behind Render's proxy, weakening its actual protection.
3. [RESOLVED July 19 2026 — see commit `e641ad6`] Company Admin had no "Add Driver" UI.
   **Backend needed nothing new** — checked first rather than assumed: `POST /users`
   already existed, already company_admin-only (`requireRole('company_admin',
   'school_admin')` + a `CREATABLE` map restricting company_admin to `driver`/
   `company_admin`), already tenant-scoped (inserts through `req.db`, which stamps the
   caller's `company_id`), already tested (creation, duplicate-email 409, cross-side-role
   403, list/read isolation, driver-can't-list-users 403) — the exact same endpoint
   `StaffAccessPage.tsx` already uses for school_admin creating school_staff. Added the one
   gap that wasn't covered: `school_admin creating a driver -> 403` (the reverse cross-
   side-role direction; only the company_admin-creating-school_staff direction existed
   before). 146/146 backend tests.
   **No invite/claim flow needed or built** — checked the existing pattern rather than
   inventing a new mechanism: admin-created accounts (via `POST /users`) are stamped
   `email_verified_at` immediately at creation (`src/services/users.js`: "admin-vouched"),
   so a newly-created driver can log in the moment the form succeeds, with the temporary
   password the admin set. This is the same mechanism school_admin's Staff & Access page
   already uses for school_staff — not the separate claim/placeholder + email-verification
   flow (that's only for self-serve org registration, §5.3, unrelated to admin-created
   accounts).
   **Frontend**: new "Add Driver" card on `CompanyAdminDashboard.tsx` (full name, email,
   phone, temporary password), mirroring `StaffAccessPage.tsx`'s create-staff form.
   Invalidates the `['users', 'driver']` query on success so the existing "Live Driver
   Status" table and the Payroll Summary driver dropdown both pick up the new driver
   immediately, with no other page changes needed.
   **Verified live, full loop**: logged in as `admin@3bees.test`, submitted the Add Driver
   form with a real test account — it appeared instantly in Live Driver Status and the
   Payroll dropdown, with a confirmation message ("... can now sign in with the password
   you set"). Logged out, logged back in *as the new driver* with that exact password —
   landed on a fully working Driver dashboard (check-in button, correct tenant's students
   in the trip-logging dropdown), zero console errors. Confirmed tenant isolation directly
   against the live API: `GET /users?role=driver` as `jamie@greenvalley.test` (a different
   company) returned `[]` — the new driver is invisible outside its own company. Test
   driver account deleted from Neon afterward.
4. **Contradicted by direct verification, not adding as stated.** This session's task
   description claimed "School Staff role is missing its core functional pages (trip
   confirmation etc)." `client/src/pages/school-staff/SchoolStaffDashboard.tsx` has a full
   "Pending Custody Confirmations" section (driver name/phone, Confirm button) and a
   "Granted Students" table — not a stub. The prior session (commit range through `2e9f915`)
   verified this live end-to-end: logged trip as `driver1@3bees.test`, confirmed it as
   `jordan@willowcreek.test`, watched status flip from "Awaiting your confirmation" to
   "Complete". If something is actually broken here now, it needs its own fresh live
   reproduction — this entry as originally worded isn't accurate against current code.
5. **Contradicted by direct verification, not adding as stated.** This session's task
   description claimed "School Admin's student view is missing contact info."
   `client/src/pages/school-admin/StudentsPage.tsx` renders `Parent/Guardian` and `Phone`
   columns (`s.parent_name`, `s.parent_phone`) for every row. If "contact info" means
   something more specific (e.g. the linked company's contact, not the parent's), that
   needs to be re-specified — as worded, this item doesn't match current code.
6. [RESOLVED July 18 2026 — see prior session's commit `54b52ee`] Driver dashboard layout
   collapse, Tailwind v4 theme-token collision. Full writeup below.
7. [RESOLVED July 19 2026 — see commit `ad2d1d0`] No `GET /schools` endpoint — the
   company_admin Students page's "existing school" dropdown showed a raw `school_id`
   instead of a name. Added `GET /schools` (`server/src/routes/schools.js` +
   `src/services/schools.js`), company_admin-only, returning `{id, name}` for schools the
   caller's company already has a student at — deliberately narrow (not a general schools
   directory), so it can't be used to enumerate unrelated org names. Uses the raw `pool`
   (not `req.db`), matching `src/services/placeholders.js`'s pattern: `schools` has no
   `company` entry in the scoped accessor's `TABLE_SCOPE`, so a cross-tenant read like this
   is structurally impossible through the normal accessor and has to go around it
   deliberately, the same way placeholder creation does.
   `client/src/pages/company/StudentsPage.tsx` now queries `GET /schools` instead of
   deriving a school-id list from its own students query. 5 new backend tests (a
   company_admin sees the real name of a school it has a student at; a company with no
   students anywhere sees none — isolation; school_admin/driver/unauthenticated all
   rejected), 145/145 passing.
   **Verified live**: logged in as `admin@3bees.test` (company_admin of 3 Bees
   Transportation, which has students at Willow Creek Elementary per the seed data) on the
   live deployed site, opened the Students page's "Add a Student" form, and the "existing
   school" dropdown showed **"Willow Creek Elementary"** — a real name, not a raw id. Zero
   console errors.
8. [PARTIALLY RESOLVED July 19 2026 — mirror repo NOT deleted, see why below] Live deploy
   ran off a public mirror repo (`saferoute-tms-deploy`), not the real `saferoute-tms` repo.
   `saferoute-tms` was private when the mirror was created (Render's API can't clone a
   private repo without the account owner connecting GitHub via the dashboard); it has
   since been made public. **What was done and verified working**: confirmed
   `saferoute-tms` is genuinely public (unauthenticated GitHub API call: `"private":
   false`; unauthenticated `git ls-remote` succeeds). `PATCH /v1/services/{id}` on both the
   backend web service and the frontend static site updated their `repo`/`branch` fields to
   `https://github.com/SiefAnas/saferoute-tms` / `overnight/deploy-and-finish` (the still-
   unmerged PR branch — not `main`, which doesn't have this work) — same service ids, same
   `onrender.com` URLs. Manually triggered a deploy on both immediately after repointing;
   Render's own logs show `Cloning from https://github.com/SiefAnas/saferoute-tms` (the
   real repo). Live sanity pass afterward: backend `/health` → `{"status":"ok"}`, frontend
   root → 200, a real login (`admin@3bees.test`) succeeded.
   **What did NOT work, caught before claiming success**: the task explicitly asked to
   verify that "a normal push... triggers auto-deploy correctly," as its own separate check
   from the manual API-triggered deploy above — and it doesn't. Pushed a real commit with a
   plain `git push origin overnight/deploy-and-finish` (no push to the mirror) and waited
   ~6 minutes; no deploy was ever auto-triggered, despite the service's own config showing
   `autoDeploy: "yes"`, `autoDeployTrigger: "commit"`. Checked why rather than assuming it
   was just slow: `GET /repos/SiefAnas/saferoute-tms/hooks` returns `[]` — no webhook
   registered on the real repo at all (the mirror's `/hooks` is *also* `[]`, so Render
   doesn't use classic per-repo webhooks; it uses its own GitHub App's installation-level
   event delivery instead, invisible to that endpoint — but the practical, observed fact
   stands regardless of mechanism: pushes to `saferoute-tms` don't trigger anything, pushes
   to the mirror always did). This points to the same root cause as the original private-
   repo blocker: Render's GitHub App was never installed/authorized for `saferoute-tms`
   specifically (being public only unblocks anonymous clones for manual/API-triggered
   deploys, not the push-webhook path, which needs the App installed regardless of
   visibility) — and installing it is the same interactive dashboard step (Connect GitHub →
   grant access to this repo) that was flagged as un-doable autonomously in the original
   deploy session.
   **Net result**: both services now genuinely run off the real repo's code (verified: a
   manual deploy trigger works, logs confirm the clone source, the site is live and
   functional) — a real improvement, no longer serving a public copy of otherwise-private
   code. But going forward, a plain push to `saferoute-tms` will **not** auto-deploy; either
   (a) Anas does the one-time "Connect GitHub" step in Render's dashboard for
   `saferoute-tms`, after which auto-deploy should work the normal way, or (b) deploys need
   a manual trigger (Render dashboard's "Manual Deploy" button, or the API call used here)
   after each push. Per the task's own instruction not to delete the mirror until the
   replacement is *proven*, not just configured — it isn't, for the auto-deploy path
   specifically — **the mirror repo (`saferoute-tms-deploy`) was deliberately NOT deleted**.
   **Update, same day**: Anas connected GitHub for `saferoute-tms` in Render's dashboard.
   Confirmed live: a plain `git push origin overnight/deploy-and-finish` (commit `e641ad6`,
   this session's Add Driver work) auto-deployed both services on its own
   (`trigger: "new_commit"` in Render's own deploy record, no manual API call involved) —
   the option-(a) path above is now live, resolving the last open piece of this item. The
   mirror repo (`saferoute-tms-deploy`) still hasn't been deleted — it's inert (nothing
   pushes to it or points Render at it) and costs nothing to leave as a fallback; deleting
   it wasn't part of this session's task.
9. [RESOLVED July 19 2026 — see commits `156375d`, `8589c6d`] `trust proxy` not set —
   `express-rate-limit` logged an `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` warning on every
   production request behind Render's proxy, and was keying rate limits off an unreliable
   IP resolution. Fix: `app.set('trust proxy', 3)` in `server/src/app.js`.
   **The "1 hop" assumption commonly cited for Render was checked live and found wrong for
   this deployment, not applied on faith.** A temporary diagnostic (first a console.log,
   switched to exposing it directly in `/health`'s JSON response after Render's log-query
   API proved too slow to check against reliably) captured a real production request's raw
   `X-Forwarded-For`: `"<real client>, <cloudflare edge>, <render internal hop>"` — 3
   entries, not 1. Render fronts this app with Cloudflare (confirmed separately via the
   `Server: cloudflare` header present on every response from both this API and the static
   site) *in addition to* its own internal routing layer. Tested `trust=1` through `trust=4`
   directly against Express's own `req.ip` resolution logic (not just reasoning about it):
   `trust=1` resolved to the Render-internal hop's private `10.x` address (wrong — an
   internal address, not any client); `trust=3` correctly resolved to the real client's
   public IP; `trust=4` also worked (over-trusting by one hop is harmless once the real
   count is met/exceeded, but `3` is the precise, non-inflated value). Deliberately not
   `true` — that would trust the entire `X-Forwarded-For` chain unconditionally, letting a
   client spoof its own IP by prepending fake entries to its own header.
   **Verified live**: (1) confirmed via the same `/health`-exposed diagnostic that `req.ip`
   now resolves to the real client IP, not an internal address; (2) removed the diagnostic,
   redeployed, sent 5 real requests through the search-claimable endpoint, and confirmed
   *zero* `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` warnings in Render's logs afterward (previously
   one per request); (3) confirmed rate limiting still actually works, keyed correctly by
   real IP — hit the search endpoint 60 times from this one real client (no `X-Forwarded-For`
   spoofing) and got a `429` with `ratelimit-limit: 60`, `ratelimit-policy: 60;w=900`,
   matching the configured `RATE_LIMIT_SEARCH_MAX`/window exactly; (4) confirmed no
   collateral damage — logged in successfully as all 4 seed roles (company_admin, driver,
   school_admin, school_staff) and confirmed CORS still correctly allows the production
   frontend origin; `req.ip`/`req.ips` aren't referenced anywhere else in the codebase
   (grepped), so the change's blast radius is exactly rate-limiting, nothing else. 140/140
   tests pass throughout (the test environment sends no `X-Forwarded-For` header, so the
   trust-proxy value doesn't affect it).
   **Caveat for the future, noted in the code comment**: this is a fixed hop count based on
   what Render's infrastructure does *today*. If Render changes its internal routing (adds
   or removes a hop), this would need re-verifying the same way — temporarily exposing
   `req.ip`/the raw header and checking a live request — not just adjusting the number on
   assumption.
   **Also noticed during this session**: Render's log-query API (`GET /v1/logs`) was
   unreliable for checking recent application `console.log` output against in near-real-time
   — repeated identical-looking responses despite new requests, and no visible propagation
   for several minutes in one instance. Exposing diagnostic info directly in an HTTP response
   was far more reliable for this kind of live verification. Not a product bug to fix, just
   a note for future sessions doing similar live checks.

**Note on items 4 and 5 above:** re-read both files fresh and grepped the relevant
components before writing this section, rather than transcribing the task prompt's
claims verbatim — they don't hold up against current code. Not silently going along with
an inaccurate premise, per this project's own established convention (see
`PROJECT_STATE.md` §6 and the addendum in §7 for two earlier instances of the same
principle). Flagged to the user in-session; happy to re-add with corrected wording if
there's a more specific reproduction.

**Status as of July 19 2026, after item #3**: every numbered item above is now either
resolved (1, 3, 6, 7, 8, 9), investigated with no code bug found (2), or contradicted by
current code and not real to begin with (4, 5). Nothing is currently open in this
Known-broken list.
One thing worth flagging rather than silently confirming: this session's task closing
instructions asked to "confirm this was the last open item... except the parked Stitch
design-polish pass" — there is no such item tracked anywhere in this list, in
`PROJECT_STATE.md`, or in git history. The only "Stitch" reference in either file is
`PROJECT_STATE.md`'s note that the Company Admin dashboard deliberately omits the Stitch
mockup's live-map/fleet-health/alerts panels (§4, since that data doesn't exist yet) — a
documented scope decision, not an open or parked backlog item. If there's a real, separate
polish pass in mind, it needs its own entry here (or wherever it's actually tracked)
before a future session can act on it.

## Resolved
- ~~Driver dashboard rendered in a collapsed near-zero-width column on desktop~~ — root
  cause was a Tailwind v4 theme-token naming collision, not a missing responsive
  breakpoint. `client/src/index.css`'s `@theme` block defines a custom 8px-rhythm spacing
  scale (`--spacing-xs/sm/md/lg/xl`, for padding/gap utilities per DESIGN.md). Tailwind v4
  resolved `DriverLayout.tsx`'s `max-w-lg` utility against that same `--spacing-lg: 24px`
  token instead of its own built-in ~512px named max-width scale, compiling to
  `.max-w-lg { max-width: var(--spacing-lg) }` (24px) — collapsing the driver shell's main
  content column to near-zero width regardless of viewport size, so everything inside
  (status cards, trip form, trip list) crammed together. Confirmed isolated to this one
  instance (`grep` across `client/src` for any other `w-/max-w-/min-w-/h-/max-h-/min-h-`
  utility using an `xs/sm/md/lg/xl` suffix found none). Fixed by using an explicit
  arbitrary value (`max-w-[32rem]`) in `DriverLayout.tsx` instead of the ambiguous named
  utility — preserves the original intended ~512px mobile-shell width without touching the
  shared `--spacing-*` theme tokens other pages may depend on. Verified live: desktop-width
  (1440px) render is now a properly centered ~512px column (unchanged design intent — this
  is a deliberate mobile-first shell per the file's own comment, not a responsive-grid
  page like Company/School admin), and the driver's actual trip data (check-in status,
  student list, logged trips) displays correctly once un-crammed.
  **Follow-up not done here** (out of scope for this fix): the underlying
  `--spacing-{name}` vs. named max-width-scale collision could silently affect any
  *future* use of a `w-`/`max-w-`/`min-w-`/`h-`-family utility with an `xs/sm/md/lg/xl`
  suffix anywhere else in the app. Worth a follow-up to rename the custom spacing tokens
  (e.g. `--spacing-gap-lg`) to avoid the collision at the source, rather than relying on
  everyone remembering to use arbitrary values.

## Open — awaiting a decision from Anas
- **No `GET /schools` endpoint for company_admin** — the new Students management page
  (`/company/students`) lets company_admin create a student against an *existing* school,
  but can only offer that school by raw `school_id` (labeled by student count), never a
  name, since no endpoint exposes school names to a company-side caller (schools are a
  root tenant table with no cross-tenant read exposed outside the placeholder-creation
  service). Workaround in place: creating a brand-new school via the existing
  `POST /placeholders/school` flow *does* return a name, since the caller is the creator.
  Fixing the existing-school case needs a small new endpoint (e.g. `GET /schools?ids=...`
  scoped to schools the caller's company already has students at) — deliberately not added
  without a go/no-go, since it's a new cross-tenant read surface.
- **Postgres RLS** — optional defense-in-depth on top of the app-layer scoped accessor.
  Large, invasive change (every table + per-request session-variable/role handling in the
  connection pool). Not started pending a go/no-go given its size relative to MVP.
- **Real email transport — code done, needs live credentials only Anas can enter.** As of
  2026-08-25, `src/mail/mailer.js` supports real SMTP sending via `nodemailer`, auto-activated
  when `SMTP_HOST` is set (Resend's SMTP endpoint); `NODE_ENV=test` always forces the dev
  transport regardless. What's left is not code: Render's env vars (`SMTP_HOST`, `SMTP_PORT`,
  `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` = Resend API key, `MAIL_FROM`) need to be entered
  directly by Anas in Render's dashboard — an AI assistant should not be entering API keys
  into third-party account settings on anyone's behalf. Once set, a real send through Resend
  hasn't yet been verified end-to-end against the live Render deploy (see 2026-08-25 entry).
- **Transitive high-severity vulns from `node-pg-migrate`** (`glob`, `brace-expansion`,
  `ip-address` — SSRF/CIDR-parsing and DoS advisories) — surfaced by `npm audit` while adding
  `nodemailer` this session, pre-existing and unrelated to that change. `npm audit fix --force`
  wants to bump `node-pg-migrate` to a new major (breaking change); not attempted here since
  it's out of scope for a safety-focused pass. Worth a dedicated look before go-live.

## Resolved — hardening pass
- ~~`resendVerification` hygiene~~ — now invalidates all prior unconsumed tokens for the user
  before issuing a new one, and no-ops (without revealing why) unless the user's org is
  genuinely still `pending_claim`. `test/07-hardening.test.cjs`.
- ~~`searchClaimable` unauthenticated + unthrottled~~ — `express-rate-limit` added across all
  unauthenticated endpoints (login, signup/claim, claimable search, verify/resend), not just
  this one route. Disabled under `NODE_ENV=test` (the existing suites fire many legitimate
  requests at these routes) with a `RATE_LIMIT_FORCE=1` override to exercise the real limiter
  in `test/07-hardening.test.cjs`.
- ~~No input validation~~ — `src/validate.js`: shared email-format / password-strength (min 8,
  matching the frontend) / max-length checks, applied at signup, user creation, and
  placeholder creation.
- ~~`email_verified_at` semantics overloaded~~ — documented, not normalized: a single
  comprehensive comment in `src/middleware/authorize.js` explains all three distinct meanings
  (verification waived / actually proven / admin-vouched) and why unifying them behind one
  operate-rights check is correct rather than a design smell.
- ~~Defense-in-depth on claim finalize~~ — a losing pending-claimant (from a 24h-expiry
  takeover) is now deactivated (`is_active = false`) when the winning claimant's verification
  finalizes the claim, not just blocked downstream by `requireOperable`. Confirmed this
  actually strengthens an existing regression test in `03-claim.test.cjs` (previously expected
  403; now the losing claimant can't even log in — 401).
- ~~Confirm/sweep race (cosmetic)~~ — the scoped accessor's `update()` gained a `where` option;
  `confirmTrip` now guards on `status='pending'`, so a concurrent auto-complete sweep landing
  in the gap makes the confirm throw 409 deterministically instead of silently overwriting the
  row. `05-trips.test.cjs`'s regression test updated to assert the new deterministic 409
  (previously asserted only that the end state stayed valid, since the race was unresolved).
- ~~`trip_count` bump isn't transactional~~ — `logTrip`'s insert + session `trip_count`
  increment now run in one transaction (`src/db/tx.js`, extracted from `signup.js`'s
  `withTx` so both services share it) instead of two separate `pool.query` calls.
- ~~Driver contact info on School Staff's screen~~ — decided (name + phone, not a full
  contact endpoint): `listTrips`/`getTrip`/`logTrip`/`confirmTrip` all enrich their trip
  response with `driver_name`/`driver_phone`, looked up via the trip's already-scoped
  `session_id` (enrichment on rows the caller already passed the scoped read for, not a new
  general-purpose driver-lookup surface). Displayed on the School Staff dashboard next to
  each pending confirmation. Verified live against Neon end-to-end (driver logs a trip via
  the real API, staff sees "Driver: Marcus Rodriguez · 555-0187", confirms successfully).
- Full suite: **140/140** (`01`-`07`), including `07-hardening.test.cjs` (18), the extended
  `05-trips.test.cjs` regression, and its driver-contact-enrichment assertions (4 new).
  Verified live against Neon (health/login/claimable search, and separately the driver-
  contact feature end-to-end) in addition to the isolated embedded-Postgres suite.

## From the School Admin/Staff screens (Step 4) — deferred, agreed, no action needed
- **"Company linking" is placeholder-creation only** — §7.3 says School Admin can "link" to
  an existing company, but per §4 there's no join table; the company↔school relationship is
  derived from `Students.company_id`. There's no real "link" action to build beyond creating
  a Company placeholder (mirrors the existing company_admin→school placeholder flow) — this
  is the final, implemented behavior, not an open gap.

## Step 3 status — COMPLETE
- Placeholder creation (a3134ca), Users/Vans/Students/Sessions/Assignments/PayRules (a3134ca),
  Trips with two-way confirmation + 5-min auto-complete (bb1bbf8). The `school_staff`
  granted-students sub-scope landed with Trips (via the accessor's `ownerIn`).

## Testing infra status — RESOLVED
- ~~Persistent local Postgres~~ — resolved via Neon (free tier). `server/.env` (gitignored)
  points DATABASE_URL at a live Neon instance; all 8 migrations applied.
- ~~No real `npm test`~~ — resolved. `server/test/*.test.cjs` run against isolated embedded
  PostgreSQL instances, one distinct port each to avoid a Windows port-release race.
  `npm run test:neon` smoke-checks the live Neon DB separately and cleans up after itself —
  not part of `npm test` since it touches shared state.
