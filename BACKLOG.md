# Backlog

Deferred items surfaced during implementation. Spec §9 already tracks the broader v2 list
(reporting, notifications system, billing, branding, photos, van maintenance); this file is
for things noticed while building that aren't in the spec's own backlog.

## From the Step 3 claim-slice review (deferred, agreed)
- **`resendVerification` hygiene** — issues a new token without invalidating prior ones
  (multiple valid tokens can coexist) and doesn't confirm an active pending claim exists.
- **`searchClaimable` is unauthenticated + unthrottled** — placeholder-name enumeration / DoS
  surface. Add rate limiting (a general MVP gap, not just here).
- **No input validation** — email format, password strength, field lengths. Add a cross-cutting
  validation layer.
- **`email_verified_at` semantics are overloaded** — for fresh signups it means "verification
  waived," not "email proven." Document or normalize.
- **Defense-in-depth on claim finalize** — beyond the `requireOperable` fix, consider
  deactivating losing pending-claimants when a claim is finalized.

## From the Trips slice review (low-severity, non-exploitable — backlogged)
- **Confirm/sweep race (cosmetic):** `confirmTrip` reads status then updates without an atomic
  `WHERE status='pending'` guard. If the auto-complete sweep lands in the gap, a staff confirm
  can write `staff_confirmed_at` onto an already-swept trip, leaving `auto_completed=true` *and*
  both timestamps. End state is still a valid `complete` trip (proven by a regression test) —
  only the `auto_completed` flag is cosmetically off. Hardening: conditional update on
  `status='pending'` (needs a `where`/status option on the accessor's update).
- **`trip_count` bump isn't transactional** with the trip insert (two statements) — a failure
  between them could drift the per-shift count. Low severity.

## From the School Admin/Staff screens (Step 4) — deferred, agreed
- **Driver contact info on School Staff's screen** — §7.4 wants driver/company contact info
  alongside a granted student's trips. Deferred: there's no safe endpoint today (`GET /users`
  is admin-only), and exposing driver PII to school_staff needs a deliberate, scoped design
  (name only? via a Trips join, or a dedicated endpoint?) rather than a rushed addition.
  School Staff screen ships without it for this pass.
- **"Company linking" is placeholder-creation only** — §7.3 says School Admin can "link" to
  an existing company, but per §4 there's no join table; the company↔school relationship is
  derived from `Students.company_id`. There's no real "link" action to build beyond creating
  a Company placeholder (mirrors the existing company_admin→school placeholder flow).

## Step 3 status — COMPLETE
- Placeholder creation (a3134ca), Users/Vans/Students/Sessions/Assignments/PayRules (a3134ca),
  Trips with two-way confirmation + 5-min auto-complete (bb1bbf8). The `school_staff`
  granted-students sub-scope landed with Trips (via the accessor's `ownerIn`).
- Next: Step 4 (React frontend).

## Testing infra status — RESOLVED
- ~~Persistent local Postgres~~ — resolved via Neon (free tier). `server/.env` (gitignored)
  points DATABASE_URL at a live Neon instance; all 8 migrations applied.
- ~~No real `npm test`~~ — resolved. `server/test/*.test.cjs` (105/105) run against isolated
  embedded PostgreSQL instances, one distinct port each (5450-5454) to avoid a Windows
  port-release race. `npm run test:neon` (5/5) smoke-checks the live Neon DB separately
  and cleans up after itself — not part of `npm test` since it touches shared state.

## Hardening (post-MVP or as time allows)
- **Postgres RLS** as belt-and-suspenders on top of the app-layer scoped accessor.
- **Real email transport** (SMTP / provider) to replace the dev mailer.
