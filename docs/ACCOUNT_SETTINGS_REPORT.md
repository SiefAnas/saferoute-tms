# Account settings report

Date: 2026-10-02. Branch `account-settings`, made from `main` (`d33f078`) in its own worktree.
**Not merged, not pushed.** The branch has no upstream on purpose. Only the local dev database was
used (embedded Postgres on port 5499). No Neon, no Render. One near miss is described under
"Surprises".

Open questions (31, plus the purge notes): `docs/ACCOUNT_SETTINGS_QUESTIONS.md`.
Step-by-step log: `docs/ACCOUNT_SETTINGS_PROGRESS.md`.

| # | Task | Commit |
|---|---|---|
| 1 | Migration 030 | `0cf5280` |
| 2 | Own account API | `0e6ab8a` |
| 3 | My account page | `c3f9aae` |
| 4 | Usage + billing (read only) | `0c8dca2` |
| 5 | Legal pages + acceptance | `874c5e3` |
| 6 | Closure, request side only | `bbffd94` |

---

## What I built

### 1. Migration 030 (`server/migrations/1752624000030_account-settings.js`)
- `users`: `pending_email`, `pending_email_token_hash` (unique when set), `pending_email_sent_at`.
- `companies`: `billing_plan` (default `pilot`), `billing_status` (default `free`), `trial_ends_at`,
  `closure_requested_at`, `closure_purge_at`, `closure_requested_by` (FK, `SET NULL`),
  `closure_undo_token_hash`. CHECKs: plan in (`pilot`), status in (`free`,`closing`), both closure
  dates set or both null.
- `legal_acceptances` (document in `terms`/`privacy`; no cascade from users, on purpose) and
  `usage_snapshots` (unique company + day).
- Down migration drops all of it. Tested up, down, up on the local DB, including the constraints.

### 2. Own account API (every role)
- `GET /users/me`, `PATCH /users/me` (only `full_name`, `phone`, `address`; anything else in the
  body is a 400 and nothing is saved; same length limits as the admin edit; parents can't clear
  phone/address).
- `POST /users/me/email-change` (password check, 409 if any account uses the address, hashed
  token, link to the **new** address via the existing mailer, verify rate limiter), plus
  `POST /users/me/email-change/resend` and `DELETE /users/me/email-change` for the page's resend
  and cancel.
- `POST /auth/confirm-email-change` (public): swaps the email, clears the pending fields, signs out
  every session (reuses `password_changed_at`). 24-hour link, single use, re-checks the address
  isn't taken.

### 3. My account page (`/account`)
- One route, rendered inside the signed-in role's own shell (`RoleShell` in `App.tsx`), so the
  driver keeps the driver tabs, the admin the admin sidebar, etc.
- Profile (ProfileCard; address for driver and parent), Email (current email, change form, "check
  your inbox" state with resend and cancel), Password (PasswordField + strength meter, existing
  `POST /auth/change-password`, keeps the session with the returned token).
- `/confirm-email-change` landing page for the emailed link.
- Linked with a `manage_accounts` icon next to logout: admin sidebar footer, driver/parent/monitor
  wide sidebar, and the phone header.

### 4. Usage + billing (read only)
- `GET /companies/me/usage`, `GET /companies/me/billing` (company_admin; one shared SQL in
  `services/usage.js`).
- `server/scripts/snapshot-usage.js [--dry-run]`: one row per claimed company per day, re-run
  updates today's row. Not scheduled.
- `/company/billing` (Settings > Billing): "Pilot - free through the end of the year" and the five
  counts. Nothing else.

### 5. Legal pages + acceptance
- `client/src/legal/terms.md` and `privacy.md`: clearly marked PLACEHOLDER text, frontmatter
  `version: 0.1-placeholder`, `effective: 2026-10-02`.
- Public `/terms` and `/privacy`, rendered by a small parser (`client/src/lib/markdown.ts`, React
  elements only, no HTML injection, no new dependency, with a Node test).
- "Privacy · Terms" links in the login/auth footer, the admin sidebar footer, the wide
  driver/parent/monitor sidebar and the phone footer.
- Register: required "I agree to the Terms of Use and Privacy Policy" checkbox with both links. The
  server requires `acceptLegal` (400 without, 409 for an outdated version) and writes one row per
  document with the version and `req.ip`, in the same transaction as the account.

### 6. Closure, request side only
- `POST /companies/me/closure` (company_admin, password + exact company name): `closing`, purge
  date in 30 days, hashed undo token, undo email to the admin, every session of the company
  signed out.
- Login (403) and the auth middleware (401) refuse every user of a closing company with code
  `ACCOUNT_CLOSING` and a message that gives the purge date and how to undo.
- `DELETE /companies/me/closure?token=…` (public): clears every closure field and restores
  `free`, only before the purge date.
- `/company/account` (Settings > Company account): danger zone with the Close account modal (real
  counts from the usage endpoint, password, type-the-name, plain text). After closing, the login
  page says what happened. `/company-closure/undo` landing page for the emailed link.
- **No purge job and no delete anywhere.** What the purge would have to do is in the questions
  file.

## What I changed in existing code
- `services/passwords.js`: exports `passwordChangedNow` (used by email confirm and closure).
- `services/schools.js`: exports `LINKED_TO_COMPANY_SQL` (usage counts schools the same way as
  `GET /schools`).
- `services/signup.js`, `routes/signup.js`: acceptance required, IP passed in.
- `routes/auth.js`, `middleware/authenticate.js`: confirm-email-change route, closing refusal.
- `routes/users.js`, `routes/companies.js`: new `/me…` routes (the undo route is declared before
  the companies router's auth chain).
- Client: `App.tsx` (routes, nav items, `RoleShell`), `AdminLayout.tsx` and `components/mobile.tsx`
  (account icon, legal links), `AuthScreen.tsx` (legal links), `RegisterPage.tsx` (checkbox),
  `LoginPage.tsx` (one-time notice), `lib/auth.tsx` (notice helpers), `ParentProfilePage.tsx` (now
  points to My account instead of "contact your company"), `types/api.ts`.
- Tests: suite 01's migration count 29 → 30; suite 03 and `scripts/e2e-roles.mjs` send
  `acceptLegal` where they expect a successful signup. New suites 32 (70), 33 (24), 34 (22),
  35 (49). Client: `test/markdown.test.ts` (18), added to `npm test`.
- Docs: `API_CONTRACT.md` (own account, usage/billing, signup acceptance, closure),
  `TMS_PROJECT_SPEC_1.md` changelog line.

## Test results
- Server: **all 34 suites pass** (see "Full suite" below).
- Client: `tsc -b`, `vite build`, `npm test` (all five files) pass. `oxlint`: no new warnings.
- Live on the local DB (seeded with `scripts/seed-dummy-data.js`): driver email change end to end
  (request → pending state → link → signed out → new email), admin sidebar + My account, Billing
  page counts, `/terms`, register with and without the checkbox (2 acceptance rows with version +
  IP), close account → login notice → login refused → undo link → sign in again. Snapshot script
  run on the local DB (dry run, then twice).

## What I could not finish / didn't do
- **Purge job**: not written, by instruction. Notes for it are in the questions file.
- **Acceptance for accounts that didn't self-register** (admin-created users, claim approvals,
  everyone who existed before): no rows, no "accept to continue" screen (question 20).
- **Snapshot scheduling**: script only, by instruction.
- **`server/test/smoke-neon.cjs`** was already broken (signs up without address/zip/state) and
  targets Neon; not touched, not run.
- **Mobile apps**: not changed. They'll get `ACCOUNT_CLOSING` 401/403s and should show the
  message (documented in API_CONTRACT). No mobile My account screen.

## Surprises
1. **The Browser pane's `preview_start` runs from the original clone, not this worktree.** Its
   "api" config started `C:\Users\anas2\saferoute-tms\server` with that clone's `.env`, which is
   production Neon (PENDING.md already warns that file points at Neon). I noticed from a pg SSL
   warning and stopped it within a minute. What reached Neon: `GET /health` (no query) and one
   failed `POST /auth/login` for `admin@company1.com` (a SELECT; failed logins write nothing). No
   migration, no write. After that I ran both servers by hand from the worktree with
   `DATABASE_URL` pointing at the local DB. Worth fixing generally: the main clone's `.env`
   pointing at production makes any "run the API locally" a production action.
2. **Daylight saving.** 30 days from today crosses Nov 1 2026 (US fall back), so
   `now() + interval '30 days'` is 30 calendar days but 30×24h + 1h. The code is right; my first
   test assumed exact seconds and failed.
3. **React Router v7 navigates in a transition.** Logging out and navigating to `/login` with
   state lost the state: the urgent auth update rendered first and `ProtectedRoute`'s own
   `<Navigate to="/login" replace>` won. The login notice now goes through sessionStorage.
4. **The spec said "no self-service edit" for drivers/parents/staff** (§2.1), tested as such. This
   task reverses that on purpose; the spec now has a changelog line.
5. **No `/company/account` existed** and there's no Markdown library in the client: both were
   built new (questions 19 and 24).

## Full suite
`npm test` in `server/`: 30 suites passed in the full run. 03, 20, 33 and 34 crashed before any
check with "pre-existing shared memory block is still in use" (the known Windows embedded-Postgres
issue in PENDING.md). I stopped the orphaned `io_worker` processes left by this worktree's own test
runs (not the dev DB, not other clones) and re-ran those four on their own: 03 (49), 20 (49), 33
(24), 34 (22), all passed. New suites: 32 own account (70), 33 usage/billing (24), 34 legal (22),
35 closure (49).

---

# Addendum: tasks 7–10 (2026-10-03)

Same branch and worktree, still **not merged, not pushed**, no upstream. First thing this session:
`server/.env` DATABASE_URL host `localhost:5499` (db `saferoute_dev`, no sslmode), nothing set in
the shell. Local embedded Postgres only; no Neon, no Render.

| # | Task | Commit |
|---|---|---|
| 7 | Legal documents on the server | `46c843c` |
| 8 | Remove the extra page (`/company/account`) | `be3c7fc` |
| 9 | Data deletion request button (migration 031) | `a9dbc2f` |
| 10 | `license_number` investigation (report only) | `d440769` |

## What I built / changed

### 7. Legal documents on the server
- `terms.md` / `privacy.md` moved (git mv) to `server/src/legal/`; `client/src/legal/` deleted.
- New public `GET /legal/:document` (`terms` | `privacy`) → `{ document, version, effective,
  markdown }`; anything else 404.
- `services/legal.js` rewritten: one source, both files validated (`version`, `effective`), no
  fallback. `src/index.js` loads them before listening; if it can't, it logs `[legal] FATAL …`
  (file + reason) and exits with code 1.
- Signup acceptance unchanged in behavior, now checked against the server's copy.
- Client: `useLegalDoc(id)` fetches and parses; `/terms`, `/privacy` and the register checkbox use
  it (register sends the versions it fetched).
- Tests: suite 34 reads the new path, checks the endpoint, and boots `index.js` with a missing and
  a broken `LEGAL_DIR` (exit 1, message on stderr). Client markdown test no longer reads files.

### 8. One page fewer
- Close account is a `CloseAccountSection` at the bottom of `/company/profile`, company_admin only,
  outside the form, behind a top rule, in its own red-bordered card with a red "Danger zone" title.
- `/company/account` route is a redirect to `/company/profile`; the Settings nav item is gone. No
  server or test change was needed (nothing referenced the route).

### 9. Data deletion request
- Migration 031 `deletion_requests` (as specified; reason ≤ 500, status in `open`/`closed`, one open
  per user via a partial unique index, no cascades). Up / down / up tested on the local DB.
- `GET` / `POST /users/me/deletion-request` (driver, monitor, parent; 403 for others; verify rate
  limiter). Emails SafeTurns support and every active admin of the person's company. Nothing is
  deleted, approved or denied.
- New `SUPPORT_EMAIL` server setting (in `.env.example`). If unset, admins are still emailed and
  each request logs `SUPPORT_EMAIL is not set` with its id. **Set it on Render before shipping.**
- My account: "Request my data be deleted" section with explanation and an optional 500-character
  reason; shows the open request instead of the form while one exists.
- Suite 36: 28 checks (happy path, duplicate, three at once, closed-then-again, limits, roles, no
  SUPPORT_EMAIL).

### 10. `license_number`
`docs/LICENSE_NUMBER_USAGE.md`. Nothing depends on the value. It is stored, shown, edited,
imported and exported, and that's all. Dropping it needs two releases: first remove the code that
writes it (otherwise `POST /users` and imports fail), then the migration. Nothing was changed.

## Test results
- Server `npm test`: **all 35 suites pass in a single full run** (36-deletion-request 28,
  34-legal 37, 01-schema 20 with 31 migrations, and every older suite).
- Client: `tsc -b`, `vite build`, `npm test` (payrollCycle, localDate, weekdays, money, markdown)
  pass; no new lint warnings.
- Live on the local stack (API 4100, Vite 5174): API logs the loaded legal versions; `/privacy` and
  `/register` fetch from `/legal/*`; `/company/account` lands on Company profile with the danger
  zone below the form (modal opens; dismissed without submitting); a seeded parent's deletion
  request was sent, the admin email appeared in the dev mail log, the missing SUPPORT_EMAIL was
  logged, and the "Request sent" state survived a reload. That request is left open on the local DB.

## Not done / open
- Questions 32–42 in `docs/ACCOUNT_SETTINGS_QUESTIONS.md`. The ones that need you: the
  `SUPPORT_EMAIL` address (35), school staff deletion requests (36), "refuse to start" vs.
  "fail only the legal endpoints" (32), and the bulk-import NULL bug (42).
- No deletion-request inbox, no handling, no confirmation email to the requester (all as asked or
  noted).

## Surprises
1. **Someone else's API is now running on port 4000** (`node --watch src/index.js`, started
   2026-10-03 12:22, not from this session). I don't know which checkout or database it uses, so I
   left it alone. My Vite from yesterday proxied `/api` to 4000, so I stopped it before using the
   browser, and ran my API on 4100 and Vite on 5174 with `VITE_API_BASE_URL` pointing straight at
   it. My curl never reached the other server (I noticed the port clash before sending it).
2. **`Card` overrides a border passed in `className`.** It sets `border-card-line` itself, so the
   red danger border only applies with `!border-…`.
3. **A pre-existing bulk-import bug** turned up during the license-number search: updating an
   existing record by import writes NULL into fields that import type doesn't have (staff
   `address`; non-driver `license_number`). Found by reading the code, not reproduced, not fixed.

---

# Addendum: tasks 11-14 (2026-10-04)

Branch `account-settings`, worktree `saferoute-account`. Checked first: `server/.env`
`DATABASE_URL` host is `localhost:5499` (local). Nothing merged, nothing pushed, no Neon, no
Render. The previous session's local DB helper was gone with its scratchpad, so a fresh embedded
Postgres was started on 5499 for this session (the request left open there yesterday no longer
exists). New migration is **033**; 032 stays reserved for `company-timezone`.

## Must be set on Render

| Variable | Value | Why |
|---|---|---|
| `SUPPORT_EMAIL` | `support@safeturns.com` | Data deletion requests are emailed here. Unset = support is never told, only the org's admins are. |

## 11. Support address
- `server/.env.example`: `SUPPORT_EMAIL=support@safeturns.com`, with a comment saying it must be set
  on Render and covering the school roles.
- `README.md`: new "Support address" section (what it is, where it goes, must be set on Render,
  what happens when it's unset).
- The loud log is unchanged: with it unset, every request logs
  `[deletion-request] SUPPORT_EMAIL is not set: SafeTurns support was NOT emailed about request <id>`.
- Addressing confirmed: suite 36 now runs with `SUPPORT_EMAIL=support@safeturns.com` and checks the
  exact recipient list of each request, for the company shape and the school shape
  (`support@safeturns.com` plus the right admins, nobody else).

## 12. School staff deletion requests
- **Migration 033** `deletion-requests-school`: `deletion_requests.company_id` is nullable, new
  nullable `school_id` (references `schools`, indexed), check `deletion_requests_one_owner`:
  `num_nonnulls(company_id, school_id) = 1`. Existing rows all have a company and pass as they are.
  `down` **refuses** (raises) while any school-shaped row exists rather than deleting it.
  Tested on the local DB: up, down, up; and down with a school row present fails and leaves the
  row (test row removed afterwards).
- `services/deletionRequests.js`: open to `school_admin` and `school_staff`. Their request records
  `school_id` (company null). The email goes to SafeTurns support and the school's active
  `school_admin`s, and says "the school's admins". Company-side roles unchanged.
- One open request at a time: the partial unique index is on `user_id`, so it already covers both
  shapes. Tested for school staff (sequential duplicate, then allowed again after closing) and for a
  school admin (three at once: one 201, two 409).
- A school admin isn't emailed their own request. With no other active school admin, only support
  gets it. (The same `id <>` filter is on the company side, where it never matches: company admins
  can't request.)
- Client: My account shows the section to school roles too, with "your school's admins" wording.
  `API_CONTRACT.md` updated.
- Suite 36: 28 -> 41 checks (school staff happy path, row shape, recipients, email text, duplicate,
  closed-then-again; school admin race and recipients; the constraint refusing both and neither,
  allowing either one). 403 for roles is now company_admin only.

### Roles checked against "anyone who cannot close their own account can request deletion"
| Role | Can close own account? | Can request deletion? |
|---|---|---|
| driver | no | yes (company) |
| monitor | no | yes (company) |
| parent | no | yes (company) |
| school_admin | no (schools have no closure) | **yes, new** (school) |
| school_staff | no | **yes, new** (school) |
| company_admin | only by closing the **whole company** | no |

Those are all six roles in `users_role_check`. **One gap to decide:** a company admin in a company
with more than one admin can't close just their own account; their only option closes the
company for everyone. Under the rule as written they "can close", so I left them out, but if you
mean "close my own account without taking the company with me", company admins are still missing
the right. Opening it is one line in `COMPANY_ROLES` plus a test.

## 13. Payroll comment and wording
- `client/src/lib/payrollCycle.ts` and the drawer in `PayrollPage.tsx`: the comments now say where
  the server puts the cutoff. Shifts: `check_in_at >= paid_through_at` (timestamp). Adjustments:
  `work_date >= paid_through_at` compared as dates, so **an adjustment dated the same day a cycle is
  marked paid carries into the next cycle**. Confirmed by running it: mark paid, then add an
  adjustment dated today, and `/payroll/unpaid-summary` counts it (1234 cents) in the new cycle.
- Driver drawer: new line above "Shifts worked" when the driver has been paid before:
  "Last marked paid Oct 4 at 05:15 PM. This cycle has the shifts that started after that, and
  adjustments dated Oct 4 or later." I used "last marked paid" rather than "paid through" because
  the paid day itself is in the next cycle for adjustments, so "paid through Oct 4" would say the
  opposite of what happens.
- No logic changed.

**Mismatch found, not fixed (needs your go-ahead, it's a logic change):** the drawer's
*adjustments list* uses `isOnOrAfterCycleStart`, which parses a bare `work_date` as UTC midnight
and so **leaves a same-day adjustment out of the list**, while the server's total (which the drawer
shows as "owed") **counts it**. So the list and the total disagree for that one case. The
client test `client/test/payrollCycle.test.ts` asserts the exclusion ("was the bug"), so the
earlier fix went the wrong way for adjustments. The fix is to compare adjustments by calendar
date (`work_date >= paid date`) and flip that test case. A second, smaller edge: the server takes
"the paid day" from the server process's clock/time zone, and the page formats it in the browser's,
so near midnight they can name different days.

## 14. Honest placeholder legal text
- `server/src/legal/terms.md` and `privacy.md` now say plainly: SafeTurns is not yet open to the
  public, the document isn't finished and is being prepared, it'll be published here before the
  service opens, questions to support@safeturns.com (privacy also mentions the Account page
  deletion request), and "this page is a notice, not terms of use / a privacy policy". No terms,
  rights, obligations or data practices are stated. I left out any claim about who is using the
  service now, because I can't verify one.
- Frontmatter untouched: `version: 0.1-placeholder`, `effective: 2026-10-02`, so the loader, the
  signup acceptance and existing acceptances all behave as before. You may want to bump the version
  when the real text goes in (that will make signups record the new one).
- Suite 34: the "marked PLACEHOLDER" check is now "reads as the being-prepared notice, no
  PLACEHOLDER filler".

## Merging note
Suite 01 now expects 32 applied migrations on this branch. Merged with `company-timezone` (032) it
will be 33.

## Test results (tasks 11-14)
- Server `npm test`: 35 of 36 suites passed in the full run (01-schema 20 with 32 migrations,
  34-legal 37, 36-deletion-request 41). **27-duplicate-student-flag** died at startup
  (`FATAL: undefined`) because I'd left an orphaned scratch Postgres on its port 5477. That was
  my mistake, not the code. After stopping it, 27 passed alone (18/18).
- Client: `tsc -b` and `vite build` pass. `payrollCycle`, `localDate`, `markdown`, `weekdays` and
  `money` tests pass. No lint output on the changed files.
- Migration 033 on the local DB: up / down / up, and down refusing while a school row exists.
- **Not checked live in the browser.** Starting the API for the preview was refused by the
  session's permission check, so the two UI changes (school roles' deletion section, the payroll
  cutoff line) are checked only by type-check and build.
