# Access scope report (branch `access-scope`)

Date: 2026-09-23. Branch `access-scope`, made from `main` (`b7a890f`). **Not merged.**

Two jobs on this branch:
1. **Email must never fail a request** (first commit). No-show and skip-pickup saved their row and
   then answered 500 when the notification email failed.
2. **Every role sees only the students it deals with.** The main gap was the driver: they could
   read every student and van in their company.

---

## 1. Email never fails a request

- New `sendMailSafe(message, event)` in `server/src/mail/mailer.js`: catches the error, logs
  `[mail] send failed event=<type> code=<smtp code> error=<message with addresses replaced by [email]>`
  and returns `false`. No recipient, subject or body in the log.
- `notifyCompanyAndSchoolAdmins()` (`services/notifications.js`) never throws now: a failed
  recipient lookup or send is logged, each recipient is sent on its own, and `notified` lists
  only the emails that were actually sent.
- **Every place that sends email** was checked and fixed the same way:

| Where | Event name in the log | Before |
|---|---|---|
| Driver no-show (`POST /schedule/:id/no-show`) | `no_show` | 500 after save |
| Parent skip pickup (`POST /parent/students/:id/skip-pickup`) | `pickup_skip` | 500 after save |
| School schedule change (`POST /schedule-changes/students/:id`) | `schedule_change` | 500 after save |
| Trip auto-complete sweep (background) | `trip_auto_completed` | sweep error logged, other notices lost |
| Claim signup verification email | `claim_verification` | 500 after the claim was saved (user can "resend") |
| Resend verification | `resend_verification` | 500 |
| "Your placeholder was claimed" notice after verify | `placeholder_claimed` | 500 after the claim was finalized |

- Extra-recipient lookups (driver emails for skips, driver + parent emails for schedule changes)
  are also caught, so admins are still notified if that lookup fails.
- Test: **suite 18** (`server/test/18-mail-failure.test.cjs`) forces the mailer to throw. No-show,
  skip-pickup and schedule change still answer 200/201, the rows are saved, `notified` is `[]`,
  the log names the event and has no email address or student name. With the mailer working
  again, notifications go out and `notified` lists them.

---

## 2. The rule

| Role | Can see students |
|---|---|
| company_admin | only students of their own company |
| school_admin | only students of their own school |
| school_staff | only students granted to them (`staff_student_access`) |
| parent | only their own linked children, only through `/parent/*` |
| driver | only students on the driver's own assignments (morning or afternoon) that are active today or start in the future. Not ended assignments, not other drivers' students |

Out-of-scope get by id returns **404** (not 403). Full table of which role can call which
endpoint: `API_CONTRACT.md` section 0 ("Access rules").

### Where the driver rule lives (one place)
- `driverScope(req, refColumn)` in `server/src/middleware/authorize.js`, next to `ownerScope`.
  Returns an accessor option: rows whose id is in "the driver's own assignments that have not
  ended". Used for students (`'student_id'`), vans (`'van_id'`) and assignments (`'id'`).
- The "not ended" window is one SQL function, `assignmentNotEndedSql()` in `server/src/db/scoped.js`
  (`end_date IS NULL OR end_date >= CURRENT_DATE`). The scoped accessor uses it (new
  `ownerIn.notEnded` option, assignments only), and so do the raw-SQL places: driver school
  lookup, `/schedule/today`, and the new `findTodaysAssignment()`.
- Driver **writes** use `findTodaysAssignment(req, { studentId | assignmentId }, shift)` in
  `services/schedule.js`: the driver's own assignment that runs **today** and covers that shift.
- No date logic was changed: the same `CURRENT_DATE` comparisons the app already used.

---

## 3. Audit: every endpoint that returns student data

"Embedded" = the response carries student data (name, id, address…) inside another object.

| Endpoint | Roles allowed | Scoped how (now) | Status |
|---|---|---|---|
| `GET /students` | company_admin, school_admin, school_staff, driver | company / school / granted / **driverScope** | **Fixed** (driver had the whole company) |
| `GET /students/:id` (+ embedded `contacts`) | same | same; out of scope → 404 | **Fixed** (driver) |
| `POST/PATCH/DELETE /students…`, contacts | company_admin | tenant | OK |
| `GET /vans`, `GET /vans/:id` | company_admin, driver | company / **vans on own not-ended assignments** | **Fixed** (driver had the whole fleet) |
| `GET /schools/:id` | company_admin, driver | schools the company has students at / **schools of own not-ended assignments' students** | **Fixed** (driver) |
| `GET /schools`, `/schools/me` | company_admin / school roles | names of company's schools / own school | OK (no students) |
| `GET /assignments`, `GET /assignments/:id` (embed `student_id`) | company_admin, driver | company / **own, not ended** | **Fixed** (driver saw own ended ones) |
| Assignment overrides | company_admin | tenant | OK |
| `GET /schedule/today` (embeds student name, grade, parent name/phone) | driver | own, active today | OK (now uses the shared window SQL) |
| `POST /schedule/:id/no-show` | driver | was: own assignment, any date/shift | **Fixed**: other driver / ended → 404, future or other shift → 409 |
| `POST /trips` | driver | was: any student in the company | **Fixed**: not own/ended → 404; not on today's run for that shift → 409 |
| `GET /trips`, `GET /trips/:id` (embed `student_id`) | company_admin, school_admin, school_staff, driver | company / school / granted / trips on own shifts | OK (see "not sure" 1) |
| `POST /trips/:id/confirm` | school_admin, school_staff | school / granted | OK |
| `GET /sessions…` | company_admin, driver | company / own | OK (no student data) |
| `GET /dashboard/absent-today` (embeds names) | company_admin, school_admin, school_staff | company / school / granted | OK |
| `GET /schedule-changes` | school_admin, school_staff | school / granted | OK |
| `POST /schedule-changes/students/:id` | school_admin, school_staff | was: staff could log for **any** student at the school | **Fixed**: staff → granted only (404) |
| `GET /payroll/summary/:driverId`, adjustments, etc. | company_admin, driver (own id) | tenant / own | OK (no student data in responses) |
| `/parent/me`, `/parent/students`, `/:id/detail`, `/:id/skip-status`, `/:id/skip-pickup` | parent | linked children only | OK (suite 16) |
| Company routers (`/students`, `/trips`, `/sessions`, `/assignments`, `/vans`) | parent | `denyRoles('parent')` → 403 | OK |
| `GET/POST/DELETE /parent-access` (embeds `student_id`) | company_admin | company | OK |
| `GET/POST/DELETE /staff-access` (embeds `student_id`) | school_admin | school | OK |
| `/users…`, `/companies/me`, `/placeholders…`, `/signup…`, `/auth…` | various | tenant | OK (no student data) |
| Search, CSV export | — | no server endpoint; the web CSV export uses `GET /students` (company_admin) | OK |
| Notification emails (contain student names) | — | sent to company admins, school admins, the student's own driver(s) and linked parents | OK |

---

## 4. Tests

- **Suite 17** (`server/test/17-access-matrix.test.cjs`), new, 57 checks: 2 companies, 2 schools,
  2 drivers in company A (+1 in B), students on active / ended / future / no assignment, a
  parent with one child, a staff member with one grant. For every role: list, get by id and an
  embedded response (trips, schedule/today, assignments). Includes: driver A can't see driver B's
  student, an ended assignment's student is 404, a future assignment's student is visible, driver
  can't log a trip or report a no-show for a student that isn't theirs (and nothing is saved).
- **Suite 18**: email failure (above).
- Existing suites changed only where they expected the old, wider driver access:
  - 04: driver `GET /schools/:id` with no assignment there is now 404; added a 200 check once the
    driver has a student at that school.
  - 05: the driver's two students now get assignments (a driver can only log trips for their own
    students).
  - 14: d1 has "Conflict Kid" for the morning only (the afternoon run is d2's), so d1's afternoon
    trip for that child is now refused (new 409 check); the afternoon trip uses d1's all-day
    student instead.
  - 15: the driver sees the van number of their own assignment's van, and not other vans.
  - 16: the driver reads their own assignment's student (200) and not another student (404).
- Results: see "Test results" at the end.
- **e2e** (`server/scripts/e2e-roles.mjs`) against the local API on Neon: added a "Driver scope"
  section (second driver, second van, other-driver / ended / future students; lists, get by id,
  vans, schools, assignments, trip and no-show refusals, driver two can't read driver one's
  student). **59 passed, 0 failed.**

### Test data left in Neon by the e2e run (all `muekdz3c`, `@example.test`)
Companies "MVP Test Transport muekdz3c", "MVP Test Other Co muekdz3c"; school "MVP Test
Elementary muekdz3c"; placeholder "MVP Test School muekdz3c"; drivers `mvp-driver-muekdz3c@…`,
`mvp-driver2-muekdz3c@…`; parent `mvp-parent-muekdz3c@…`; staff `mvp-staff-muekdz3c@…`; vans
`MVP-muekdz3c`, `MVP2-muekdz3c`; 4 students "MVP Test Student … muekdz3c"; 4 assignments; one
session and one trip. No real accounts touched. Emails were not sent (no SMTP vars locally).

---

## 5. Client and mobile still work with the narrower data

**Web driver app** (`client/src/pages/driver/*`): Today, Trips and the student sheet only ask for
students on `/schedule/today` (`GET /students/:id`, `GET /schools/:id`), the driver's own
`/assignments`, `/vans` (then picks the van of today's active assignment), `/sessions`, `/trips`.
All of these return the same data for the driver's own students. Trips tab names come from the
schedule, not from `/students`. `tsc -b`, `vite build` and client tests pass. No change needed.

**Mobile app** (branch `mobile-app`, `mobile/src/features/driver/*`): calls `/schedule/today`,
`/sessions`, `/trips`, `/assignments`, `/students/:id` (only ids from today's schedule),
`/schools/:id` (school of a student on today's schedule), `/vans/:id` (van of today's active
assignment), plus check-in/out, `POST /trips` and no-show from the Today list. **Nothing the app
calls is blocked** for the driver's own data. No mobile code changed.

---

## 6. Things I wasn't sure about (picked the safer option)

1. **Driver's own trip history.** `GET /trips` for a driver still returns all trips on the
   driver's own shifts, including one for a student whose assignment has since ended. It's the
   driver's own work record and only has the `student_id` (no name/address); the student itself
   is 404. Kept as is. If you want, filter those out too (small change in `trips.js` readScope).
2. **Driver writes are stricter than reads.** A future assignment's student is visible, but
   logging a trip / no-show needs the assignment to run **today** and cover **that shift**, so
   those answer 409. Both apps only log from today's schedule, so nothing changes for them.
3. **Ended vs "ends today".** An assignment with `end_date` = today still counts (same rule as the
   rest of the app). "Today" is still the database's `CURRENT_DATE` (UTC on Neon). The open
   Boston/Cairo timezone decision in `PENDING.md` applies here too; I didn't touch date logic.
4. **school_admin sees every student at their school from any company**, including address and
   notes. That's what the rule says ("own school"); flagging it in case you'd rather hide some
   fields from schools.
5. **School staff schedule change** was a real hole (staff could cancel today's pickup for any
   student at the school). Fixed to granted students only, same as their reads. school_admin
   unchanged.
6. **Local test harness:** twice the embedded Postgres left `io_worker` processes behind and
   suites failed with "shared memory block is still in use" (known issue in `PENDING.md`). I killed
   the strays (only `postgres.exe` from this repo's `server/node_modules/@embedded-postgres`) and
   re-ran.

---

## Test results

Server (`npm test`, all 18 suites on the embedded Postgres): **all pass**.

```
==== 01-schema: 20 passed, 0 failed ====
==== 02-auth-rbac: 17 passed, 0 failed ====
==== 03-claim: 35 passed, 0 failed ====
==== 05-trips: 22 passed, 0 failed ====
==== 06-staff-access: 12 passed, 0 failed ====
==== 07-hardening: 19 passed, 0 failed ====
==== 08-boot-safety: 8 passed, 0 failed ====
==== 09-parent-and-permissions: 30 passed, 0 failed ====
==== 10-no-show: 11 passed, 0 failed ====
==== 11-payroll-paid: 12 passed, 0 failed ====
==== 12-dashboard: 5 passed, 0 failed ====
==== 13-pickup-confirmation: 27 passed, 0 failed ====
==== 14-shift-period: 62 passed, 0 failed ====
==== 15-van-number-company-profile: 30 passed, 0 failed ====
==== 16-parent-scope: 22 passed, 0 failed ====
==== 17-access-matrix: 57 passed, 0 failed ====
==== 18-mail-failure: 16 passed, 0 failed ====
==== 04-resources: 88 passed, 0 failed ====
```
(04 is from a re-run on its own: the full run started before its test fix was saved.)

Client: `npm test` (payrollCycle 5/5, localDate 27/27), `tsc -b` OK, `vite build` OK.

e2e against the local API on Neon: 59 passed, 0 failed.
