# Backlog

Deferred items surfaced during implementation. Spec §9 already tracks the broader v2 list
(reporting, notifications system, billing, branding, photos, van maintenance); this file is
for things noticed while building that aren't in the spec's own backlog.

## Resolved
- ~~Driver dashboard rendered in a collapsed near-zero-width column on desktop~~ — root
  cause was a Tailwind v4 theme-token naming collision, not a missing responsive
  breakpoint. `client/src/index.css`'s `@theme` block defines a custom 8px-rhythm spacing
  scale (`--spacing-xs/sm/md/lg/xl`, for padding/gap utilities per DESIGN.md). Tailwind v4
  resolved `DriverLayout.tsx`'s `max-w-lg` utility against that same `--spacing-lg: 24px`
  token instead of its own built-in ~512px named max-width scale, compiling to
  `.max-w-lg { max-width: var(--spacing-lg) }` (24px) — collapsing the driver shell's main
  content column to near-zero width regardless of viewport size, so everything inside
  (status cards, trip form, trip list) crammed together. Confirmed isolated to this one
  instance (`grep` across `client/src` for any other `w-/max-w-/min-w-/h-/max-h-/min-h-`
  utility using an `xs/sm/md/lg/xl` suffix found none). Fixed by using an explicit
  arbitrary value (`max-w-[32rem]`) in `DriverLayout.tsx` instead of the ambiguous named
  utility — preserves the original intended ~512px mobile-shell width without touching the
  shared `--spacing-*` theme tokens other pages may depend on. Verified live: desktop-width
  (1440px) render is now a properly centered ~512px column (unchanged design intent — this
  is a deliberate mobile-first shell per the file's own comment, not a responsive-grid
  page like Company/School admin), and the driver's actual trip data (check-in status,
  student list, logged trips) displays correctly once un-crammed.
  **Follow-up not done here** (out of scope for this fix): the underlying
  `--spacing-{name}` vs. named max-width-scale collision could silently affect any
  *future* use of a `w-`/`max-w-`/`min-w-`/`h-`-family utility with an `xs/sm/md/lg/xl`
  suffix anywhere else in the app. Worth a follow-up to rename the custom spacing tokens
  (e.g. `--spacing-gap-lg`) to avoid the collision at the source, rather than relying on
  everyone remembering to use arbitrary values.

## Open — awaiting a decision from Anas
- **No `GET /schools` endpoint for company_admin** — the new Students management page
  (`/company/students`) lets company_admin create a student against an *existing* school,
  but can only offer that school by raw `school_id` (labeled by student count), never a
  name, since no endpoint exposes school names to a company-side caller (schools are a
  root tenant table with no cross-tenant read exposed outside the placeholder-creation
  service). Workaround in place: creating a brand-new school via the existing
  `POST /placeholders/school` flow *does* return a name, since the caller is the creator.
  Fixing the existing-school case needs a small new endpoint (e.g. `GET /schools?ids=...`
  scoped to schools the caller's company already has students at) — deliberately not added
  without a go/no-go, since it's a new cross-tenant read surface.
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
- ~~Driver contact info on School Staff's screen~~ — decided (name + phone, not a full
  contact endpoint): `listTrips`/`getTrip`/`logTrip`/`confirmTrip` all enrich their trip
  response with `driver_name`/`driver_phone`, looked up via the trip's already-scoped
  `session_id` (enrichment on rows the caller already passed the scoped read for, not a new
  general-purpose driver-lookup surface). Displayed on the School Staff dashboard next to
  each pending confirmation. Verified live against Neon end-to-end (driver logs a trip via
  the real API, staff sees "Driver: Marcus Rodriguez · 555-0187", confirms successfully).
- Full suite: **140/140** (`01`-`07`), including `07-hardening.test.cjs` (18), the extended
  `05-trips.test.cjs` regression, and its driver-contact-enrichment assertions (4 new).
  Verified live against Neon (health/login/claimable search, and separately the driver-
  contact feature end-to-end) in addition to the isolated embedded-Postgres suite.

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
