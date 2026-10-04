# Production safety + bulk import fix

Date: 2026-10-04. Branch `prod-safety-and-import-fix`, made from `main` (`d33f078`) in its own
worktree (`C:\Users\anas2\saferoute-prodsafety`). **Not merged, not pushed**, no upstream. Only a
local embedded Postgres was used. First check this session: the worktree had no DATABASE_URL at all
(no `server/.env`, nothing in the shell or Windows environment); I gave it a gitignored
`server/.env` pointing at `localhost:5499` and confirmed the connection (`server reports ::1,
saferoute_dev`) before doing anything else.

| # | Task | Commit |
|---|---|---|
| 1 | Refuse non-local databases unless `ALLOW_PRODUCTION_DB=yes` | `220c543` |
| 2 | Bulk import never blanks fields the import type doesn't have | `7a01911` |
| 3 | A blank Notes cell no longer overwrites a student's note with "None" | `f9c6480` |
| 4 | Import preview shows old → new for every update, flags overwrites | `f1f7504`, `fe537ae` |

---

## ⚠ Before you merge: what Render needs

**On the Render API web service, add this environment variable, then merge:**

| Variable | Value | Why |
|---|---|---|
| `ALLOW_PRODUCTION_DB` | `yes` (exactly, lowercase) | Without it the API logs "REFUSING TO START THE API" with the Neon host and exits 1 at startup. Render shows a failed deploy and keeps the previous version serving. |

Nothing else on Render changes. Details:
- **Set it before the merge/deploy.** Today's code ignores it, so adding it early is harmless.
- **Migrations:** if they run on Render (Pre-Deploy or `npm run migrate:up && npm start`), the same
  service variable covers them. If you still run them from your laptop against Neon (what
  `docs/migration-deploy-options.md` describes), put the flag on that one command:
  - bash: `ALLOW_PRODUCTION_DB=yes npm run migrate:up`
  - PowerShell: `$env:ALLOW_PRODUCTION_DB='yes'; npm run migrate:up; Remove-Item Env:ALLOW_PRODUCTION_DB`
- **Static site (web client):** nothing; it never connects to the database.
- **GitHub Actions `db-backup.yml`:** nothing; it runs `pg_dump`, not our Node code.
- **Any future Render cron job or one-off job** that runs server code (e.g. the usage snapshot
  script on `account-settings`) needs `ALLOW_PRODUCTION_DB=yes` too.
- **After deploying:** the Render log should show "SafeTurns API listening…" and no "REFUSING".

---

## Task 1: stop the app connecting to production by accident

### The rule (one place)
`server/src/db/productionGuard.js`:
- Local = `localhost`, `127.0.0.1`, `::1` / `[::1]`. Anything else is refused unless
  `ALLOW_PRODUCTION_DB` is exactly `"yes"` (`YES`, `true`, `1`, `" yes"` all refuse).
- Also refused: DATABASE_URL missing, not a URL, or no host.
- A `host=` query parameter is checked too, because node-postgres connects to it instead of the
  host in the URL: `postgres://localhost/db?host=prod.example.com` would otherwise look local.
- Refusal: a framed multi-line message on stderr naming the host it was about to reach, saying
  `ALLOW_PRODUCTION_DB=yes` is required and what it's currently set to, then `exit 1`. Nothing has
  connected at that point. Example (from the test run):
  ```
  ==============================================================================
    REFUSING TO START THE API: possible production database
  ==============================================================================

    DATABASE_URL points at a database that is NOT on this machine:

        host: prod-db.example.invalid

    Anything that only runs on this machine must use localhost / 127.0.0.1.
    If you really mean to reach that host (the live API on Render, or a migration you
    are running against production on purpose), set:

        ALLOW_PRODUCTION_DB=yes

    It is currently not set.
    Nothing was connected to. Exiting.
  ```
- It loads `server/.env` itself (via `config.js`) before checking, so it sees exactly what the app
  and node-pg-migrate would use.

### Where it's called
| Entry point | How |
|---|---|
| API start (`src/index.js`) | First statement, before the app or the pool is loaded. |
| **Every script** (`src/db/pool.js`) | The shared pool runs the check when it's created, so any script that talks to the database, including ones written later, is covered without remembering to add it. (Verified with `scripts/claim-requests.js`, which has no guard of its own.) |
| Migrations | `npm run migrate`, `migrate:up`, `migrate:down`, `migrate:redo` now run `node scripts/check-db-target.js && node-pg-migrate …`. `migrate:create` only writes a file and is unchanged. |
| `scripts/seed-dummy-data.js` | Uses the shared check. Its own `ALLOW_REMOTE_SEED=1` is gone. |
| `scripts/e2e-roles.mjs` | Uses the shared check for `API_BASE` (the API it calls) and for `DATABASE_URL` if set. Its own `ALLOW_REMOTE_E2E=1` is gone. |

Docs: `server/.env.example` (commented `# ALLOW_PRODUCTION_DB=` with when to use it, and a warning
not to put it in a laptop `.env`) and a short README section.

### Tests: `server/test/37-production-guard.test.cjs`, 35 checks
Each real entry point is started as its own process. The "remote" host is
`prod-db.example.invalid` (`.invalid` can never resolve), so nothing in the test can reach a real
database even when the guard lets it through.
- The rule: localhost / 127.0.0.1 / [::1] pass; remote refused; remote + `yes` passes; seven
  near-miss flag values refused; `?host=` trick refused; `localhost.evil.example` refused; missing
  / invalid URL refused; the refused host is named.
- **Remote + no flag → exits:** `src/index.js` (exit 1, message names the host and the flag, never
  listens), requiring the pool, `claim-requests.js`, `npm run migrate:up` (and node-pg-migrate never
  even does a DNS lookup), seed, e2e (`API_BASE` and `DATABASE_URL`). The old `ALLOW_REMOTE_SEED=1`
  / `ALLOW_REMOTE_E2E=1` no longer open anything.
- **Remote + `ALLOW_PRODUCTION_DB=yes` → proceeds:** the app loads, `src/index.js` reaches
  "listening", the pool loads, and `npm run migrate:up` gets past the guard and fails only on the
  unresolvable host.
- **localhost + no flag → proceeds:** `src/index.js` listens; `npm run migrate:up` applies every
  migration to a real embedded Postgres.
- `08-boot-safety` changed one line: its pool-error test used `postgres://x` (host `x`), now
  `postgres://localhost/x`.

### Decisions you may want to revisit
1. **`::1` counts as local** (IPv6 localhost; the old guards allowed it too). The old guards also
   allowed the host `db` (a docker-compose service name); dropped, because nothing here runs inside
   compose (it only publishes Postgres on `localhost:5432`).
2. **The seed's extra `NODE_ENV=production` refusal is gone** ("one rule, not three"). Consequence:
   in a Render shell, where `ALLOW_PRODUCTION_DB=yes` is set, `node scripts/seed-dummy-data.js`
   would now run against Neon and create accounts with the known password `Secret123!`. Before,
   `NODE_ENV=production` blocked it. If you want that one extra stop back for the seed only, it's a
   two-line change. I'd recommend it.
3. **A hosted dev database** (README mentions Neon / Supabase as an option) now also needs the flag,
   since the guard can't tell a remote dev DB from production.
4. **`server/test/smoke-neon.cjs`** (manual, targets Neon) now needs `ALLOW_PRODUCTION_DB=yes`. It
   was already failing before this branch (it signs up without address / zip / state). Not run.

---

## Task 2: bulk import blanking fields

### The bug (reproduced, then fixed)
`execPerson()` sent four hardcoded keys (`full_name`, `phone`, `address`, `license_number`) to
`updateFields()`. `normalizeRows()` only builds the import type's own fields, so for a type
without one of those keys the value was `undefined`. `updateFields()` only skipped `''`, and
node-postgres writes `undefined` as NULL.

The new test, run against the **unfixed** code, failed exactly as described (6 failures):
- school staff `address` → NULL (the staff type has no address field), including when the file sent
  an `address` key the staff type doesn't have;
- monitor `license_number` → NULL; parent `license_number` → NULL.

### The fix (`server/src/services/bulkImport.js`)
- `execPerson` builds the update from **the type's own field list**, minus the email it matched on:
  `def.fields.filter((fd) => fd.key !== def.key).map((fd) => [fd.key, row[fd.key]])`. A field the
  type doesn't list is never written, and adding a field to a type later needs no change there.
  (Each person field key is the `users` column of the same name; noted in a comment.)
- `updateFields` also skips `undefined`, not only `''`, as a second line of defense for every
  caller (people, vans, students).
- Unchanged: a blank cell (`''`) still means "leave this value alone".

### Tests: `server/test/38-import-no-blanking.test.cjs`, 26 checks (6 failed before the fix)
Through the real `POST /imports/commit`:
- **Staff with an address, file has no address column:** address unchanged; name and phone filled
  in the file are overwritten; a second file with blank name / phone cells leaves them alone.
- **Monitor with a license number, file has no license column:** `license_number` unchanged;
  blank address and phone cells leave them alone; filled name overwrites; a later filled address
  overwrites and the license is still unchanged.
- **Parent:** `license_number` unchanged; filled cells overwrite.
- **Driver (type has the field):** blank license cell leaves it; filled cell overwrites; nothing
  else moves.
- **Keys outside the type in the file** (`address`, `license_number`, `role` for staff) are ignored.
- The existing `24-bulk-import` suite still passes (83).

### Same pattern elsewhere in the file?
- **Vans (`execVan`): no.** Every key it sends (`license_plate`, `brand`, `model`, `color`,
  `number`, `year`) is a field of the vans type, so each is a string (`''` when blank), and a blank
  year becomes `''`. Nothing undefined reaches the database.
- **Students (`execStudent`): no undefined**, but **a related bug, reproduced, not fixed:**
  `notes: row.notes || 'None'` is used for updates too, so updating an existing student with a
  **blank Notes cell overwrites their notes with "None"**. I reproduced it with a throwaway script:
  notes "Needs help buckling" became "None" after a re-import with an empty Notes column. That
  breaks the "empty cell leaves it alone" rule for exactly the field that carries safety notes for
  drivers. **Fixed in Task 3 below.**
- **Inserts** (`insertUser`, the van and student inserts) turn missing values into NULL on purpose
  (`row.phone || null`); that's correct for a new record.

---

---

## Task 3: student notes overwritten with "None" (session 2, 2026-10-04)

First check this session: `server/.env` → `localhost:5499`, server reports `::1`, `saferoute_dev`.

### The bug (reproduced by the new test before the fix)
`execStudent` built one object for both insert and update with `notes: row.notes || 'None'`. On an
update a blank Notes cell (or no Notes column at all: `normalizeRows` fills it with `''`) became the
string `'None'`, which passed `updateFields`' empty check and replaced the stored note. A roster
re-import without a Notes column therefore wiped the note of every student in the file. The new
suite failed 4 checks against the old code (every "keeps the note" case).

### The fix (`server/src/services/bulkImport.js`)
- New `studentUpdatePatch(plan)` builds what an update writes; `notes` is the raw cell, so a blank
  cell is skipped like every other field.
- The insert keeps `row.notes || 'None'`, so a **new** student with no note still gets `'None'`
  (existing behaviour).

### Tests: `server/test/39-import-student-notes.test.cjs`, 14 checks (4 failed before the fix)
- File with **no Notes column**: two students keep their notes (wheelchair / epipen, seizure plan);
  the rest of the row still updates (grade 3 → 4).
- Notes column present but **blank**, and **whitespace-only**: notes kept.
- A **filled** Notes cell overwrites.
- **New** students: no Notes column → `'None'`; blank cell → `'None'`; filled → kept.
- `24-bulk-import` (83), `26-student-id` (28), `27-duplicate-student-flag` (18), `38` (26) still pass.

### Audit: anything else that turns an empty cell into a value before `updateFields`
Every `||`, `??`, ternary and `Number(...)` in `bulkImport.js`:

| Where | Reaches updateFields? | Verdict |
|---|---|---|
| `execStudent` `notes: row.notes \|\| 'None'` | yes (was) | **The bug. Fixed.** |
| student update `age: Number(row.age)` | yes | **Latent.** `Number('')` is `0`, which would overwrite a stored age. It can't happen today: age is a required student field and `planStudents` rejects a blank or non-numeric age on every row before an update is planned. If age ever becomes optional this must become `row.age ? Number(row.age) : ''` (like the van year). Not changed. |
| van update `year: row.year ? Number(row.year) : ''` | yes | Correct: blank stays `''` and is skipped. |
| `insertUser` `row.phone \|\| null`, `row.address \|\| null`, `row.license_number \|\| null` | no (insert) | Correct for a new record. |
| van insert `row.number \|\| null`; student insert `row.student_id \|\| null`, `row.notes \|\| 'None'` | no (insert) | Intended defaults for a new record. |
| parent created from a student row (address built from street / city / state / zip) | no (insert) | Fine. |
| `p.reason ?? ''` in the duplicate checks | no (planning only) | Not data. |
| `state` upper-cased by `assertValidState` | yes | Not a default: only applied to a non-blank, valid value (required field). |

No other default turns a blank cell into a written value.

---

## Task 4: the preview shows what each update changes

### What the preview returns now (`POST /imports/preview`, additive)
- Each row gains `changes` and `overwrite`:
  - `changes`: for an **update** row, the fields whose value would actually change, as
    `{ field, label, old, new }` (`old` is `null` when the stored value is empty). Unchanged fields,
    blank cells and fields the import type doesn't have are not listed. `[]` means the update
    changes nothing. `null` for create and error rows.
  - `overwrite`: `true` when at least one change replaces a **non-empty** stored value (filling an
    empty field is not an overwrite).
- `counts.overwrite`: how many rows overwrite.
- **The import itself is unchanged.** So the preview can't drift from what commit does, the
  per-type update patches are now named functions (`personUpdatePatch`, `vanUpdatePatch`,
  `studentUpdatePatch`) and one `writtenKeys` rule decides which keys get written; `execPerson`,
  `execVan`, `execStudent` and the preview all use them. The preview reads the current rows with
  one `SELECT` per import (scoped to the caller's company / school) and writes nothing.
- Values are compared as text (a van's year 2020 vs "2021", a student's age 8 vs "9"). A plate or
  name that differs only in letter case shows as a change, because the import would write it.

### Website (`client/src/pages/ImportPage.tsx`)
- Under the counts, when any row overwrites: a caution banner, "N rows will replace information
  that is there today. Check the old and new values below before importing. Blank cells never
  change anything."
- In each update row's Result cell: an **"Overwrites existing data"** badge when it overwrites,
  then one line per change, e.g. `Address: 4 Road Ln → 9 New Rd` (an overwritten old value is struck
  through in the caution colour; a filled-in empty one shows as "empty → value"), or "No changes:
  every value is already the same." Create and error rows look as before.
- Checked live on the local stack with a 3-row drivers file (one new driver, one address
  overwrite, one row identical to the stored data): the banner said 1 row; that row showed the badge
  and `Address: 48 Cedar Ct, Springfield, IL 62701 → 99 Overwrite Ave`; the identical row showed
  "No changes". I did not import; the stored address was unchanged afterwards. The result column
  got a minimum width so old / new values stay readable on narrow screens.

### Tests: `server/test/40-import-preview-changes.test.cjs`, 21 checks
- **Create:** `changes` null, not an overwrite.
- **Update that changes one field** (fills an empty phone): exactly that field, `old: null`, not an
  overwrite; blank cells not listed.
- **Update that overwrites a non-empty value** (address): only the changed field listed (the same
  name and the same license are not), `overwrite: true`, counted.
- An update that changes nothing: `[]`. Error rows: `null`.
- The preview writes nothing; the following commit stores exactly the preview's "new" values.
- Staff file: no address change listed (not a staff field), blank phone not listed.
- Students: no Notes column → nothing listed (the note is left alone); a file that really says
  "None" → grade and notes listed with old / new, marked as an overwrite.
- Vans: year change listed, blank colour not listed.

## Test results
- New suites: `37-production-guard` 35, `38-import-no-blanking` 26, `39-import-student-notes` 14,
  `40-import-preview-changes` 21 (all passed).
- Client: `tsc -b` clean, `npm test` passes.
- Touched / related: `08-boot-safety` 8, `24-bulk-import` 83 (one expectation updated: the preview
  `counts` object now also has `overwrite`), `26` 28, `27` 18, `01-schema` 20, `02-auth-rbac` 21.
- Full `npm test`: see the last section.

## Things I found on the way
- The new worktree had **no** DATABASE_URL anywhere, so "print the host" meant first giving it a
  local-only `server/.env`. With this branch merged, a missing DATABASE_URL is itself refused with
  the same message (instead of node-postgres silently falling back to its own defaults).
- When a test run is cut short, the embedded Postgres it started stays running and the next run
  of that suite fails with "pre-existing shared memory block" (the known PENDING.md issue). Only
  this worktree's processes were stopped.

- I briefly ran a live-check API on port 4200 while a full test run was going; suite
  `02-auth-rbac` uses that port, so that run failed with EADDRINUSE (my mistake, not the code). It
  passed once I stopped the API. For local checks, avoid 4200 (and the other test ports).

## Full suite
`npm test` in `server/` after all four tasks (commit `fe537ae`): **all 34 suites pass in a single
run**, including 37 (35), 38 (26), 39 (14), 40 (21). One earlier full run showed two failures, both
explained above and fixed: the port clash with my own live-check API (02), and suite 24 expecting
the old preview `counts` shape.
