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
