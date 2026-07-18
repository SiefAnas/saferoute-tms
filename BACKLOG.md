# Backlog

Deferred items surfaced during implementation. Spec §9 already tracks the broader v2 list
(reporting, notifications system, billing, branding, photos, van maintenance); this file is
for things noticed while building that aren't in the spec's own backlog.

## Open — awaiting a decision from Anas
- **Driver contact info on School Staff's screen** — §7.4 wants driver/company contact info
  alongside a granted student's trips. There's no safe endpoint today (`GET /users` is
  admin-only); exposing driver PII to school_staff needs a scoped design decision (name-only
  via a Trips join vs. a dedicated endpoint vs. dropping the requirement for good).
- **Postgres RLS** — optional defense-in-depth on top of the app-layer scoped accessor.
  Large, invasive change (every table + per-request session-variable/role handling in the
  connection pool). Not started pending a go/no-go given its size relative to MVP.
- **Real email transport** (SMTP / provider) to replace the dev mailer — needs external
  account/API-key credentials that only Anas can provide. The mailer interface
  (`src/mail/mailer.js`) is already pluggable; swapping in real delivery later is a
  transport-layer change, not a rewrite.

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
- Full suite: **136/136** (`01`-`07`), including the new `07-hardening.test.cjs` (18) and the
  extended `05-trips.test.cjs` regression. Verified live against Neon (health/login/claimable
  search) in addition to the isolated embedded-Postgres suite.

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
