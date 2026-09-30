# Repo health

Date: 2026-09-30. Code: `origin/main` at `71367cb`. Report only; nothing changed.
**Ranked by risk** (what breaks, for whom, how likely), not by how many there are.

## 1. The same rule written twice, differently (can drift, some already have)
| # | Rule | Where | Status |
|---|---|---|---|
| 1.1 | **Which school a student may be attached to** | `POST /students` accepts any `school_id`; the bulk import only accepts the company's own schools (`listCompanySchools`) | **Already different.** Security relevant: see docs/tenant-isolation-audit.md gap 2 |
| 1.2 | **"Assignment is active today"** | Helper `assignmentNotEndedSql` / `assignmentRunsOnSql` in `db/scoped.js`, plus inline copies in `routes/students.js:59`, `services/scheduleChanges.js:85,120`, `services/parentPortal.js:66,138`, `services/payroll.js:105`, `services/schedule.js:116` | **Already different:** the school's student list (`students.js:59`) and the schedule-change driver email (`scheduleChanges.js:120`) skip the weekday check. So a Mon–Wed assignment shows as today's ride on a Thursday, and the email can go to a driver who isn't driving that child today |
| 1.3 | **Two import systems** | Per-page CSV imports (client-side, one API call per row: Drivers, Parents, Fleet, Students, Payroll) and the bulk Import page (server-side plan and commit) | **Already different.** Students CSV is create-only (every row a new student); bulk import matches name + school. Drivers CSV updates through `PATCH /users` (creator-only rule applies); bulk import has its own checks. Same file, different outcome depending on the button |
| 1.4 | **Required fields for a new student** | `POST /students` requires `notes`; bulk import defaults it to "None"; the Students CSV sends `notes: undefined` when blank | **Already broken:** a Students CSV row with an empty Notes cell fails with "notes is required", while the CSV's own error text lists every required field except Notes |
| 1.5 | **Student age** | Bulk import checks 0–25; `POST/PATCH /students` don't check and rely on the DB constraint | See 2.2 (answers 500) |
| 1.6 | **Assignment conflict rules** | Server `services/assignmentConflicts.js` and client `lib/assignmentRules.ts` (`daysOverlap`, `studentsTakenByOtherDrivers`) | Same today; any change must be made in both |
| 1.7 | **Who may create which role** | `CREATABLE` in `services/users.js` and `TYPES_BY_ROLE` in `services/bulkImport.js` | Same today; a new role must be added in both |
| 1.8 | **Account status wording** | Server `accountStatus` (users.js), web `EditAccountModal`, mobile `accountStatusText` (branch mobile-account-lifecycle) | Same meaning, three renderings |
| 1.9 | **Client and mobile `lib/` copies** | `fleet.ts`, `format.ts`, `geo.ts`, `localDate.ts`, `weekdays.ts`, `queryClient.ts` exist in both apps and have **all drifted** (9 to 66 changed lines each) | Low risk each, but date and weekday logic diverging between web and phone is how "the app says today, the website says tomorrow" bugs start |
| 1.10 | **Password rules** | Server `assertPasswordStrength`; web `PasswordStrengthMeter` scores the same signals | Server is authoritative; the meter only guides |
| 1.11 | **Role to home screen and tenant** | Server `tenantTypeForRole`; web `lib/roleHome.ts`; mobile `lib/roles.ts` | Same today |

## 2. Routes that answer 500 for normal mistakes (raw DB errors reach the user)
The central error handler turns any error without a `status` into `500 internal server error`.
Several foreseeable database errors are not mapped:
| # | Route | What happens |
|---|---|---|
| 2.1 | `DELETE /students/:id` | Trips reference students with `ON DELETE RESTRICT`. **Deleting any student who has ever had a trip answers 500.** A student without trips is hard-deleted and takes their assignments, parent links, contacts and extra addresses with them (CASCADE). No test covers either case |
| 2.2 | `POST` / `PATCH /students` with an age outside 0–25 | The DB check fires → 500 instead of a 400 message |
| 2.3 | `DELETE /vans/:id` | Assignments reference vans with RESTRICT. **Deleting a van that ever had an assignment answers 500.** No test |

## 3. Routes with no test of the success path
93 route handlers were matched against every `server/test/*.cjs`:
- `DELETE /students/:id` and `DELETE /vans/:id`: no test at all (see 2.1, 2.3). Both are destructive.
- `GET /payroll/rules`: only tested as "monitor gets 403"; the list itself is never asserted.
- Everything else has at least one call in a suite. Suite 17 (access matrix) and branch
  `tenant-isolation-audit` suite 25 cover the denial side broadly.

## 4. TODO / FIXME
Only two, both harmless:
- `client/src/pages/parent/ParentProfilePage.tsx:15`: "TODO (v2): self-service password/email change; 2FA…".
- `server/src/services/trips.js:135`: a comment saying a former TODO is now built.

## 5. Dependencies
- **Server:** every dependency is used (`node-pg-migrate` through the npm scripts).
- **Client:** all used. `xlsx` comes from the SheetJS CDN tarball (pinned with an integrity hash in
  the lockfile). `npm audit` and Dependabot don't track it; upgrades are manual.
- **Mobile:** `expo-linking` and `react-native-screens` have no direct imports but are required
  peers of `expo-router`; `babel-preset-expo` is used by `babel.config.js`. Nothing to remove.
- `npm ci` in `client/` reports existing audit warnings; not investigated here.

## 6. Dead code
Nothing significant. Only helpers exported but used just inside their own module:
`scopeColumn`, `DRIVER_OWNER_COLUMN`, `resendRequest`, `rangesOverlap` / `shiftsOverlap` /
`daysOverlap` (server), `formatAddress` / `publicExtraAddress` / `APPLIES_TO` (stops.js),
`publicUser` / `accountStatus` (users.js). Harmless; drop them from `module.exports` when touching those files.

## 7. Test environment
- Each suite starts its own embedded Postgres. On Windows the Postgres `io_worker` processes
  outlive their server. Over a full run they pile up and eventually stall `initdb` for a later
  suite, which then fails silently. This run needed a reaper (kill io_workers whose parent is
  gone) and single-suite reruns. Worth fixing in `test/lib/testkit.cjs` (kill the process tree on stop).
- Suites use fixed ports; two runs at once collide.

## Suggested order
1. 1.1 + tenant gaps (security).
2. 2.1 / 2.3 (500s on delete) and decide whether students and vans can be deleted at all or
   should be archived like users.
3. 1.2 (use the shared SQL helpers everywhere; fixes the weekday drift).
4. 1.3 / 1.4 (retire the per-page CSV imports in favour of the bulk Import, or make them call it).
5. The test-environment reaper, so future overnight runs don't need babysitting.
