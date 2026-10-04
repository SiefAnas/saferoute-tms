# `users.license_number`: where it's used

Date: 2026-10-03. Branch `account-settings`. **Investigation only: nothing was changed or dropped.**

Search: every spelling (`license_number`, `licenseNumber`, "License number", "licence") across
`server/`, `client/`, `mobile/`, scripts, tests and docs, plus whole-row reads (`SELECT *`,
`RETURNING *`, `req.db.findById/findMany('users')`) that could carry the column without naming it.
Every remote branch was counted too: none has more references than `main` (25 code lines), so
this branch covers them all.

## Short answer
- **Nothing depends on it.** No logic reads it: no matching, filtering, sorting, validation rule,
  notification, payroll, schedule or access check. It is stored, shown, edited, imported and
  exported. That's all.
- **Dropping it breaks no feature**, but it breaks code that writes it: `POST /users` and bulk
  import both always write the column (as NULL when empty), so they'd fail with "column does not
  exist" until the code stops naming it. Code first, column second (see the end).
- It is **sensitive personal data** (a government ID number). It is optional and only ever set for
  drivers.

## Where it's defined
| Where | What |
|---|---|
| `server/migrations/1752624000016_driver-fields-and-student-driver.js` | Adds `users.license_number text` (nullable, no index, no constraint, no default). Its `down` drops it. |

## Server: where it's written
| File | What |
|---|---|
| `server/src/services/users.js` `createUser` (l. 32, 42, 68) | `POST /users` takes `licenseNumber` (max 50 chars), inserts `license_number` (NULL if missing). Every role goes through this insert, not only drivers. |
| `server/src/services/users.js` `updateUser` (l. 111, 131) | `PATCH /users/:id` accepts `license_number` (max 50), creator-only. Any role, not just drivers. |
| `server/src/services/bulkImport.js` l. 29 | `drivers` import type has an optional "License number" field. |
| `server/src/services/bulkImport.js` `insertUser` l. 154–157 | Bulk-import inserts always name the column (NULL when empty), for every person type. |
| `server/src/services/bulkImport.js` `execPerson` l. 174 | Bulk-import updates set `license_number` from the row. **Pre-existing bug found here:** for types without that field (monitors, parents, staff) the value is `undefined`, which `updateFields` doesn't skip (it only skips `''`), so updating an existing monitor / parent / staff member by import sets their `license_number` to NULL. The same applies to `address` for staff (staff imports have no address field). Harmless for license numbers (those roles have none), but staff addresses get wiped. Found by reading the code (`normalizeRows` only fills the type's own fields; node-postgres sends `undefined` as NULL); not reproduced. Not fixed: this task is report only. |

## Server: where it's read
| File | What |
|---|---|
| `server/src/services/users.js` `publicUser` l. 206 | Every user object sent by `POST/GET/PATCH /users…`, `POST /users/:id/reset-password` and the new `GET/PATCH /users/me` includes `license_number` (null when unset). This is the only way it leaves the server. |
| Whole-row reads (`routes/auth.js` login, `services/account.js`, `services/passwords.js`, `parentPortal.getMyProfile`, payroll, schedule, assignments, notifications) | Read the full row but use or return other fields only. None sends `license_number` anywhere. |
| Bulk import preview | Shows the field in the column mapping for drivers; saved mappings (`import_mappings.mapping` JSON) may contain a `license_number` key. |

Not used in: emails, notifications, logs, reports, dashboard, payroll, CSV exports done on the
server (there are none), access rules, the `monitors` endpoints (monitor objects have no license).

## Client (website)
| File | What |
|---|---|
| `client/src/types/api.ts` l. 56 | `PublicUser.license_number: string \| null`. |
| `client/src/pages/company/DriversPage.tsx` l. 27 | CSV **export** column "License Number". |
| `DriversPage.tsx` l. 106–122 | CSV **import** (the page's own importer): reads a "License Number" column, sends it on create (`licenseNumber`) and update (`license_number`). |
| `DriversPage.tsx` l. 74, 278 | Add driver form: "Driver license number (optional)". |
| `DriversPage.tsx` l. 252 | Driver detail drawer: "License" row. |
| `client/src/components/EditAccountModal.tsx` l. 27, 56, 112 | Edit form field, shown and sent for drivers only. |
| `MonitorsPage.tsx` l. 25, `PayrollPage.tsx` l. 61 | Fill `license_number: null` when turning a monitor into a `PublicUser` shape (type plumbing only). |
| `pages/account/AccountPage.tsx` (this branch) | Not shown or editable on My account. `GET /users/me` returns it because it uses `publicUser`. |

## Mobile
| File | What |
|---|---|
| `mobile/src/api/types.ts` l. 251 | `PublicUser.license_number: string \| null`. |
| `mobile/app/(company)/people.tsx` l. 33, 65 | Company-admin People screen: driver details show "License" (`?? '—'`); monitors get `license_number: null`. |
| `mobile/tests/admin.test.ts` l. 13 | Test fixture field. |

Installed mobile apps read it with `?? '—'`, so if the API stops sending it they show a dash and
don't crash.

## Tests, scripts, docs
| File | What |
|---|---|
| `server/test/04-resources.test.cjs` l. 60, 80–86 | Sends `licenseNumber` on create and **asserts** it comes back, then edits it and asserts again. Would fail. |
| `server/test/09-parent-and-permissions.test.cjs` l. 115 | Sends `licenseNumber` on create (no assertion on it). |
| `server/scripts/e2e-roles.mjs` l. 109, 167 | Sends `licenseNumber` when creating drivers. |
| `server/scripts/seed-dummy-data.js` l. 74–78, 109 | Inserts it for seeded drivers. Would fail once the column is gone. |
| `server/scripts/backfill-required-fields.js` | One-off 2026-09-01 backfill that sets it; would fail if re-run. |
| `API_CONTRACT.md` l. 582 | Lists `licenseNumber` in the `POST /users` body. |
| `BACKLOG.md` l. 713, `MVP_FINISH_REPORT.md` l. 133 | History. MVP_FINISH_REPORT says license number is *required*; that's stale (optional since the 2026-09-23 auth-accounts change: "Drivers now need only name + email"). |

## Would any feature break if the column were dropped?
- **No feature depends on its value.** Nothing behaves differently with or without a license
  number.
- **Visible losses:** the Drivers page loses a form field, a drawer row and a CSV column; the
  edit modal loses a field; mobile People shows no license; bulk import loses an optional field.
- **Hard failures if only the column is dropped:** `POST /users` (every role), bulk-import
  create, and any `PATCH /users/:id` or import update carrying it would error, and the seed
  script would fail. Hence: remove the code first.
- **Old spreadsheets:** a "License Number" column in an admin's file would simply be ignored by
  both importers once the field is gone. A saved import mapping with a `license_number` key is
  harmless: the website only reads mapping keys for fields that exist, and `saveMapping` drops
  unknown keys on the next save.

## What a drop would have to touch
Two releases, because Render runs migrations **before** the new code replaces the old
(`docs/migration-deploy-options.md`). If the column went first, the still-running old code would
fail on every `POST /users` and import.

**Release 1: stop using it (no migration)**
1. `server/src/services/users.js`: remove `licenseNumber` from `createUser` (destructure, max-length
   check, insert), remove `license_number` from `updateUser`'s accepted keys and length check, and
   from `publicUser`. Decide whether a client still sending it gets 400 or is ignored (today's
   `PATCH` ignores unknown keys; `POST` ignores them too).
2. `server/src/services/bulkImport.js`: remove the field from the `drivers` type, from
   `insertUser`'s column list, and from `execPerson`'s update patch. (Good moment to also fix the
   `undefined`-means-NULL update bug above.)
3. Client: `types/api.ts`, `DriversPage.tsx` (CSV columns, CSV import, add form, drawer),
   `EditAccountModal.tsx`, `MonitorsPage.tsx`, `PayrollPage.tsx`.
4. Mobile: `src/api/types.ts`, `app/(company)/people.tsx`, `tests/admin.test.ts` (ship with the next
   app build; old builds degrade to "—").
5. Tests: `04-resources` (drop the create/edit assertions), `09` (drop the field). Scripts:
   `e2e-roles.mjs`, `seed-dummy-data.js`, `backfill-required-fields.js` (delete or mark obsolete).
6. Docs: `API_CONTRACT.md` `POST /users` body; note in `TMS_PROJECT_SPEC_1.md` changelog.

**Release 2: the migration**
7. New migration `…_drop-users-license-number.js`: `up` = `pgm.dropColumn('users',
   'license_number')`; `down` = add it back as nullable `text` (the data does not come back).
   No index or constraint to drop first. Migration 016's own `down` still drops the column; that's
   fine as long as 016 is only ever rolled back after the new migration's `down` re-added it.
8. Bump the migration count in `server/test/01-schema.test.cjs`.

**Before dropping, decide (questions for Anas):**
- Is there real license data in production? I didn't look (no Neon access in this task). A
  `SELECT count(*) FROM users WHERE license_number IS NOT NULL` on Neon answers it.
- If there is: export it for the companies first, or tell them it's going away?
- Backups: the daily Neon backup artifacts keep the values for up to 90 days after the drop.
- If the reason is "don't hold government ID numbers", it may be worth clearing the values
  (`UPDATE users SET license_number = NULL`) as soon as release 1 ships, rather than waiting for
  the column drop.
