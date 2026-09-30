# Tenant isolation audit

Date: 2026-09-30. Code: `origin/main` at `71367cb`. Tests: branch `tenant-isolation-audit`,
`server/test/25-tenant-isolation.test.cjs`. No bug was fixed; each gap is proven by a test.

**Question:** can any user read or write data that belongs to a company or school that is not their own?

**Short answer:** not by editing ids on the normal routes. Every one of 6 roles was tried against
another tenant's records on 45 direct routes, 22 list and profile routes and 6 import shapes, and
every attempt failed; a snapshot of every foreign row was unchanged afterwards. But there are
**two ways to get into another tenant's data through the side door**, one of them critical:

| # | Severity | Gap | Who can do it |
|---|---|---|---|
| 1 | **Critical** | Claiming a placeholder school needs only an email you control. The new "school admin" then reads every student any company attached to it | Anyone, no account needed |
| 2 | **High** | A company can create a student at **any** school id it sends, with no relationship to that school | Any company admin who knows the school's id |
| 3 | Low | Creating a user or signing up says whether an email is already registered anywhere in the app | Any admin; anyone via signup |
| 4 | Info | `GET /payroll/adjustments/:driverId` for another company's driver answers `200 []` instead of `404` | Company admin (no data exposed) |

---

## How isolation is enforced today (and holds)
1. **Tenant from the database, not the token.** `authenticate` re-reads the user on every request;
   `tenantType` and `tenantId` come from the `users` row. A forged or stale token can't change tenant.
2. **Scoped accessor (`req.db`).** Every `findMany/findById/insert/update/remove` adds
   `WHERE <tenant column> = <caller's tenant>` and stamps it on insert, overriding anything the
   client sends. A table with no entry for the caller's side throws (403).
3. **Composite foreign keys.** Links (assignments, parent links, staff grants, pay rules and
   adjustments, schedule changes, contacts, no-shows, monitor assignments) reference
   `(id, company_id)` or `(id, school_id)`, so a row can't point at another tenant's user,
   student or van even if the id is valid.
4. **Raw SQL** (used where the accessor can't express a query) always filters by the caller's
   `company_id` / `school_id`, or only uses ids that came out of a scoped read first. Checked in
   `payroll`, `trips`, `sessions`, `schedule`, `scheduleChanges`, `parentPortal`, `monitors`,
   `dashboard`, `stops`, `schools`, `students` (transport info), `bulkImport`.
5. **Role gates** (`requireRole`, `denyRoles`) keep parents and monitors off the company-wide routers.

## Findings

### 1. Critical: placeholder claim takeover
**Where:** `GET /signup/:kind/claimable`, `POST /signup/:kind` with `claimId`, `POST /auth/verify-email`
(`server/src/services/signup.js`).

**What happens:** a company admin adds a school that isn't on SafeTurns yet (a "placeholder",
`POST /placeholders/school`) and attaches students to it. This is the normal onboarding path.
The placeholder is searchable by name without logging in. Anyone can then claim it with any
email: verification only proves they own **their own** inbox, not that they work at the school.
Once verified they are that school's `school_admin`, and `GET /students` returns every student
any company attached there: name, grade, age, home address, parent name and phone, notes, and
the transport details (driver name and phone, van).

The placeholder's creator is emailed only after the claim is final. The same path works for
company placeholders created by schools (lower impact: a new company has no students).

**Proof:** test "KNOWN GAP 2" (company B stubs "Maple Placeholder Academy", adds a student; a
stranger finds it anonymously, claims it with `stranger@evil.test`, verifies, and reads the
student's home address and parent phone).

**Options (not built):** the creator approves the claim; or the claim link is issued by the
creator (invite) instead of self-service; or students stay hidden from a newly claimed school
until the company confirms the school; or an email-domain check against the school's website.
**Needs a product decision.**

### 2. High: a student can be attached to any school
**Where:** `POST /students` (`server/src/routes/students.js`). `school_id` comes from the client
and is only checked by a plain FK to `schools(id)`.

**What happens:** a company admin who knows a school's id can create students there even though
the company has no relationship with that school. The school's admin and staff then see those
records in their lists, and the company gains `GET /schools/:id` (address, phone, hours) because
that route's rule is "the company has a student there". This is exactly "relies only on the
client sending the right id". Ids are random UUIDs, so this needs the id; unclaimed placeholder
ids are handed out by the anonymous claim search (gap 1).

The bulk import already does the right thing (it only accepts schools from
`listCompanySchools`), so **the same rule is implemented two different ways**.

**Proof:** test "KNOWN GAP 1".

**Fix direction (not built):** in `POST /students`, require `school_id` to be one of
`listCompanySchools(company)`, as the import does. Adding the first student at a brand-new
school would then go through the placeholder flow (which lists placeholders the company created).

### 3. Low: "is this email registered anywhere?"
**Where:** `POST /users` answers `409 email already registered`; the import preview says
"already registered to another account"; `POST /signup/:kind` answers `409` too (anonymous).

Any admin, or anyone through signup, can test whether an email belongs to a SafeTurns user in
some other tenant. No data about that account is returned. **Proof:** test "KNOWN GAP 3".
Emails are the global login id, so some signal is unavoidable at creation time; the signup path
is the one worth rate-limiting harder (it is rate-limited today).

### 4. Info: inconsistent "not yours" answer
`GET /payroll/adjustments/:driverId` with another company's driver id answers `200 []` (the list
is tenant-scoped, so it is empty). Every other by-id route answers `404`. Nothing leaks; it only
differs. The test treats it as a list and checks that nothing of the other tenant appears.

## Per role: routes with a missing, weak or client-id-only tenant check

| Role | Findings |
|---|---|
| company_admin | `POST /students` `school_id` (gap 2). `POST /users` email probe (gap 3). `GET /payroll/adjustments/:id` 200-empty (gap 4). |
| school_admin | None found. Staff grants are held by composite FKs; profile edits go to the caller's own school id. |
| school_staff | None found. Reads are narrowed to granted students; schedule changes and trip confirms check the grant. |
| driver | None found. Everything is limited to own not-ended assignments and own sessions. |
| parent | None found. Denied on every company-wide router; `/parent/*` is limited to linked children. |
| monitor | None found. Denied on student routers; `/monitor/me`, own sessions and own pay only. |
| No login | Claim takeover (gap 1); signup email probe (gap 3). |

## Cross-tenant access that is intended (listed so it stays a conscious choice)
- A school's admin and staff see every company's students at that school, with driver name,
  driver phone and van (`GET /students` for the school side).
- School staff and admins can cancel a company's pickup for a student at their school
  (`POST /schedule-changes/...` writes an override on the company's assignment; raw SQL guarded
  by the student's school).
- School staff and admins confirm company trips for students at their school.
- A company reads name and details of schools it has students at (`GET /schools`, `/schools/:id`).
- The trip auto-complete sweep and notification emails run across all tenants (system jobs).

## Noticed while auditing, inside one tenant (out of scope, not tested here)
- A company admin can change the email of a co-admin whose account has no creator (the
  "grandfathered" rule in `assertCanManage`), then use "forgot password" on it: account takeover
  inside the same company.
- `POST /assignments` accepts any user of the same company as `driver_user_id` (the role is not
  checked), e.g. a parent or monitor as the "driver".

## The test suite (`25-tenant-isolation.test.cjs`)
- Seeds companies A and B and schools S1 and S2, each with admins, a driver, a parent, a monitor,
  school staff, a van, a student, an assignment, pay rule and adjustment, an open session and a
  pending trip, parent and staff links, a monitor assignment, a saved import mapping, a schedule
  override and a student contact.
- For each A-side role (company_admin, driver, parent, monitor, school_admin, school_staff):
  - **45 direct attempts** on B/S2 records (read, edit, deactivate, change email, reset password,
    delete, link, grant, assign, pay, confirm, check out, skip, no-show, schedule change,
    placeholder edit). Each must answer non-2xx.
  - **22 list and profile reads.** None may contain any B/S2 id, name or email.
  - **6 import shapes, preview and commit** (B's driver, parent and monitor emails, S2's staff
    email, a student at S2, a student with B's parent email). Nothing may be created or updated.
- Then a snapshot of every B/S2 row in 20 tables must equal the one taken before.
- **KNOWN GAP section:** asserts today's behavior for gaps 1–3, so the suite stays green while
  they are open. When a gap is fixed, its assertions must be flipped (that is the point).
- Result: 27 checks, all passing.
