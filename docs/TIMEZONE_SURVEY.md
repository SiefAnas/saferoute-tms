# Timezone survey (task 1, no code changed)

Branch `company-timezone`, from `main` (`d33f078`). Every use of `CURRENT_DATE`, `now()`,
`CURRENT_TIMESTAMP`, `new Date()`, `Date.now()` and `toISOString` in `server/src`, plus the
implicit ones a grep for those words misses (a `timestamptz` cast to `::date`, a timestamp compared
with a `'YYYY-MM-DD'` string, a column `DEFAULT CURRENT_DATE`). Line numbers are on `main`.

Buckets:
- **(a)** business date for a company: must use the company's zone.
- **(b)** audit timestamp or a duration between two instants: stays UTC, no change.
- **(c)** ambiguous, needs a decision.

Notes on mechanics, so the entries make sense:
- `CURRENT_DATE`, `x::date` on a `timestamptz`, and `'YYYY-MM-DD'` compared with a `timestamptz`
  all use the **database session timezone** (today: the Neon database-level `America/New_York`,
  set by hand; the local embedded Postgres inherits the OS zone, also New York).
- `date + time` → `::timestamptz` reads that wall time in the session timezone too.
- `now()` / `new Date()` / `Date.now()` are instants (timezone-free); they only matter when turned
  into a date.
- `EXTRACT(ISODOW FROM <date>)` on a `date` is timezone-free; on a timestamp it isn't.

**Bucket (c) has 3 entries** (each groups related lines), under the limit of five, so I continued
to task 2. Buckets (a) and (b) are listed by file below.

---

## (c) Needs a decision

| # | Where | What it decides | Why it's ambiguous | What I'll do unless you say otherwise |
|---|---|---|---|---|
| C1 | School-side "today": `dashboard.js:52-62` (school absent list), `scheduleChanges.js:36-41` (school's changes today), `scheduleChanges.js:79-108` (school staff cancels today's pickup), `routes/students.js:78` (school's student list: current transport), `scheduleChanges.js:120` (driver email lookup) | Which day is "today" for a school user | Schools have no timezone and a school's students can belong to companies in different zones. "Today" for a school request is not one date. | **Per record, the owning company's date.** A school's list of today's skips / no-shows / changes uses each row's company's "today"; cancelling a student's pickup uses the student's company's "today". No school timezone column. |
| C2 | `payroll.js:164-167` (adjustments in `summary()` when `from` is `paid_through_at`) | Whether an adjustment dated **the same day** the cycle was marked paid belongs to the old or the new cycle | `work_date` is a date, `paid_through_at` an instant. Today pg casts the instant to a date in the **Node process's** zone, so an adjustment dated the paid day counts as still owed (the client's `payrollCycle.ts` comment says the opposite was intended). | Keep today's server result (same-day adjustment = **still owed**), but decide the paid day in the **company's** zone instead of the process's. Flagged in the questions file. |
| C3 | Week schedule `start` (`schedule.js:105-125`), driver pay month range (client `DriverPayPage.tsx` sends `from`/`to`) | The client picks "this week" / "this month" from the **viewer's** device clock and sends dates | The server treats the dates correctly, but near midnight / month end a viewer in another zone asks for a different week or month than the company's. | Server unchanged in meaning (dates are calendar dates, read in the company zone). Not changing the clients in this branch; noted. |

---

## (a) Business date for a company (must use the company's zone)

### Shared SQL helpers (`server/src/db/scoped.js`)
| Line | Code | Decides |
|---|---|---|
| 50 | `assignmentNotEndedSql()` → `end_date >= CURRENT_DATE` | "Assignment has not ended": the driver access window (students, vans, schools, assignments a driver can see), used by the scoped accessor's `ownerIn.notEnded` (l. 103-105) and by raw SQL in schedule / monitors. |
| 53-60 | `assignmentRunsOnSql(alias, day)` → `EXTRACT(ISODOW FROM day)` | Weekday a run is on. Timezone-free when `day` is a date; every caller passes `CURRENT_DATE`, so the callers are the (a) entries. |

### `services/schedule.js` (driver)
| Line | Decides |
|---|---|
| 46, 51, 52, 55, 56, 57 | `/schedule/today`: which assignments run today (start date, not ended, weekday), today's override, today's extra addresses, today's parent skips / no-shows (via `scheduleItemColumns('CURRENT_DATE')`). |
| 105-125 | `/schedule/week`: day list from `generate_series($1::date …, interval '1 day')`. The dates are calendar dates, but `generate_series` with an interval runs on timestamps, which follow the session zone across DST. Make it pure date arithmetic. `assignmentNotEndedSql` (l. 119) uses CURRENT_DATE. |
| 170 | No-show insert: `no_show_date = CURRENT_DATE`. |
| 194-196 | `findTodaysAssignment`: the driver's assignment that runs today (logging a trip, reporting a no-show). |

### `services/parentPortal.js` (parent)
| Line | Decides |
|---|---|
| 61 | **Skip cutoff:** `now() < (CURRENT_DATE + pickup_time)::timestamptz - 30 min`. Both the date and the wall-clock pickup time are read in the session zone. Must be "30 min before pickup time on the company's today, in the company's zone". |
| 64, 66, 67 | Today's active assignments, today's override, weekday. |
| 81, 150 | Already skipped today (`skip_date = CURRENT_DATE`). |
| 121, 135, 136, 138 | Student detail: runs today, today's override, today's extra addresses, active today. |
| 169 | Today's trips for the detail page: `created_at::date = CURRENT_DATE` (both sides in the session zone). |
| 273, 282, 306 | Skip insert: `skip_date = CURRENT_DATE`. |

### `services/dashboard.js` (company admin)
| Line | Decides |
|---|---|
| 26 | `SELECT CURRENT_DATE::text`: the company's "today" for absent-today (skips + no-shows). |
| 56, 60 | School-side version: see **C1**. |

### `services/monitors.js`
| Line | Decides |
|---|---|
| 128 | Monitor's van: the driver's assignment that runs today. Also `assignmentNotEndedSql` on l. 130. |
| 152 | Monitor's sessions today: `check_in_at::date = CURRENT_DATE`. |

### `services/sessions.js`
| Line | Decides |
|---|---|
| 58 | "Already worked this shift today": `check_in_at::date = CURRENT_DATE`. |

### `services/payroll.js` (read in full)
| Line | Decides |
|---|---|
| 60 | Daily-rate pay: each session's work day = `check_in_at::date` (session zone). |
| 105-106 | Shift completeness: assignments active and running on that work day (`$4` is the date from l. 60, so it inherits l. 60's zone). |
| 117, 121 | No-shows / skips on that work day (same). |
| 150, 151 | **Period boundaries:** `check_in_at >= $from` / `< $to` where `from`/`to` are `'YYYY-MM-DD'` (driver pay month, dashboard): midnight in the **session** zone. Must be midnight in the company's zone. (When `from` is `paid_through_at`, an instant, that comparison is exact and stays as it is.) |
| 155 | `COUNT(DISTINCT check_in_at::date)`: days worked. |
| 166, 167 | Adjustments `work_date >= $from` / `< $to`: date vs date when `from` is a date (fine); date vs instant when it's `paid_through_at` (**C2**). |
| 200 | `paid_through_at = new Date()`: an instant, (b). |

### `services/scheduleChanges.js`
School-side; the dates belong to the student's company (see **C1**): l. 40 (today's list), 85-86 (active today), 95 + 103 (today's override), 120 (driver lookup). Also the column default below.

### `services/trips.js`
| Line | Decides |
|---|---|
| (via `findTodaysAssignment`, `driverScope`) | Logging a trip needs today's run; driver read scope uses "not ended". The trip timestamps themselves are (b). |

### Found during task 3 (missed by the task-1 grep: they reach CURRENT_DATE through `assignmentNotEndedSql()`)
| Where | Decides |
|---|---|
| `services/schools.js:62` | `GET /schools/:id` for a driver: schools of the driver's not-ended assignments. |
| `services/users.js:150` | Deactivating a driver: "N active assignments, reassign first". |
| `middleware/authorize.js:94` (`driverScope`) → scoped accessor `notEnded` | The driver read scope for students, vans, assignments. |

### Routes
| Where | Decides |
|---|---|
| `routes/students.js:78` | School's student list: transport active today (**C1**). |
| `routes/vans.js:103` | Delete-van error message: "current or upcoming" vs "past" assignments. |

### Calendar maths that should not depend on any zone
| Where | Note |
|---|---|
| `services/assignmentConflicts.js:12` | `dayNumber(new Date(dateLike))` with local `getFullYear/getMonth/getDate`: a `'YYYY-MM-DD'` string parses as UTC midnight, a pg `DATE` as local midnight, so in a process west of UTC the two disagree by a day. Overlap checks between a stored and a submitted assignment can be off by one. Depends on the **Node process** zone, not the DB. Fix with plain `YYYY-MM-DD` comparison. |

### Database defaults (migrations)
| Where | Note |
|---|---|
| `migrations/…018_schedule-changes-and-company-phone.js:24` | `schedule_changes.change_date DEFAULT CURRENT_DATE`. The insert in `scheduleChanges.js` relies on it. Pass the date explicitly instead (C1 rule). The default can stay as a fallback. |

---

## (b) Audit timestamps and durations (no change)

| Where | What |
|---|---|
| `routes/auth.js:31` | `last_login_at = now()` |
| `middleware/authenticate.js:44` | JWT `iat` vs `password_changed_at` (instants) |
| `routes/webhooks.js:19` | Svix signature 5-minute window |
| `services/passwords.js:41, 50, 57, 106, 108, 138, 143` | password change time, temp-password expiry (now + 7 days), reset token expiry (60 min) and use |
| `services/users.js:69, 72` | `email_verified_at`, temp-password expiry |
| `services/signup.js:59, 76, 120, 121, 126, 149, 154` | verification timestamps and 24 h token expiry, `claimed_at` |
| `services/claimRequests.js:95, 102, 106, 111, 122` | decision timestamps, temp-password expiry |
| `services/bulkImport.js:156, 460` | created / temp-password expiry, mapping `updated_at` |
| `services/sessions.js:75, 76, 100, 101, 105` | check-out time and duration (two instants) |
| `services/trips.js:62, 83, 146, 152` | driver / staff confirmation and completion times; the auto-complete sweep ("pending for more than 5 minutes") is a duration |
| `services/payroll.js:200` | `paid_through_at` (the instant the admin clicked Paid) |
| `services/dashboard.js:40, 41, 64` | `created_at` sent as ISO (display; the viewer's zone can format it) |
| `mail/mailer.js:89, 93, 96, 163, 173, 184` | send timestamps, timing logs |
| every `created_at` / `updated_at` / `check_in_at` column `DEFAULT now()` | instants |

## Related, not a call site
- node-postgres parses `DATE` columns into JS `Date` objects at local midnight of the **Node
  process**, then `res.json` sends `"…T00:00:00.000Z"`-style strings (API_CONTRACT.md tells clients
  to take the first 10 characters). Correct while the process runs in UTC (Render). It isn't
  business logic, but it is a second, process-level timezone dependency. Out of scope; noted for
  the report.
