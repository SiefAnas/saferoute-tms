# Backlog

Deferred items surfaced during implementation. Spec §9 already tracks the broader v2 list
(reporting, notifications system, billing, branding, photos, van maintenance); this file is
for things noticed while building that aren't in the spec's own backlog.

## Known-broken (tracked as of July 18 2026)
1. [RESOLVED July 19 2026 — see commits `e1dba8d`, `c330c08`] Registration "hangs" on
   "Submitting" for the *"Create new" org* path (not the claim path — see #2, untouched).
   Root cause (from the prior investigation session): `RegisterPage.tsx`'s `onSuccess`
   chains `signup -> login -> navigate` under one mutation, so `submit.isPending` (and the
   button) stays busy for the whole chain, not just the signup call — measured ~7.4s warm,
   with Render free-tier cold starts able to stretch that past a minute, all behind one
   static "Submitting…" label with zero differentiated feedback. Not a deadlock — a
   latency + UX-feedback gap. Fix: added a `stage` state (`'creating' | 'logging-in' |
   'loading-dashboard'`) giving each leg its own button label ("Creating your account…" /
   "Logging you in…" / "Loading your dashboard…"), plus a `showColdStartHint` reassurance
   message ("First request may take up to a minute while the server wakes up…") if the
   whole submit is still pending past ~9s. Signup/login/navigate sequencing itself is
   unchanged, per the task's own constraint.
   **Caught and fixed a real regression the fix itself introduced, before this session
   closed**: the first version used `requestAnimationFrame` to let React paint the
   "loading-dashboard" label for one frame before `navigate()`. Verified live that `rAF`
   callbacks never fire at all in a backgrounded/non-visible browser tab — confirmed
   directly (scheduled one, it never ran) — which meant a fully successful registration
   would hang forever on "Loading your dashboard…", never navigating: the exact class of
   bug this fix exists to solve, reintroduced by the fix. Swapped to `setTimeout(resolve,
   0)`, confirmed to always fire in the same live test, then re-verified the full flow
   end-to-end.
   **Verified live** (twice, against the real deployed backend/Neon DB, via a
   `MutationObserver` on the submit button capturing every label change with timestamps):
   run 1 (naturally slow/cold) showed all three stages in order plus the cold-start hint,
   then hung forever on "Loading your dashboard…" — that was the rAF bug, caught here, not
   shipped as the final state. Run 2, after the `setTimeout` fix, showed all three stages
   in order (~3.4s signup, ~2.4s login) with no cold-start hint needed (under 9s), then
   correctly landed on `/company` with the new company_admin logged in and the dashboard's
   real (empty, brand-new-org) data rendered — no functional regression. Test accounts/
   companies from both verification runs deleted directly from Neon afterward.
2. [INVESTIGATED July 19 2026 — no code bug found] Email verification. Reproduced the full
   pipeline live end-to-end against the real deployed backend and Neon DB: created a
   school placeholder → claimed it via `/register` (kind=school, claiming) → confirmed via
   Render's live app logs that the dev-mailer actually logged the verification email
   (`[mail] to=... | Verify your email...`) with a real, working token → visited
   `/verify-email?token=...` → got "Email verified / Your claim is confirmed and your
   account is now active" → logged in successfully as the new school_admin, correctly
   scoped to that school. Also confirmed the token is properly single-use: revisiting the
   same link afterward correctly showed "Verification failed / invalid or expired token"
   with a working resend form. The "Phase 4 StrictMode/useMutation fix" this session's
   task prompt referenced *is* real — it's documented in `VerifyEmailPage.tsx`'s own
   comment (the `useQuery`-keyed-by-token pattern, not a `useMutation` fired from a
   `useEffect`) — and it holds up correctly on this fresh live re-test; not a regression.
   **The actual reason a real end-user can't verify on the live deployment**: there is no
   real email transport (already tracked below, "Real email transport"). The verification
   token only ever appears in Render's private server console logs — a real person
   registering on the public live site has no way to see it. This isn't a code defect to
   fix; it's the pre-existing, already-known email-transport gap manifesting as "doesn't
   work" from a real user's point of view. No code change made — nothing was broken to fix.
   **Unrelated issue noticed while investigating** (not fixed, flagging only): every
   request logs an `express-rate-limit` `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` warning in
   production — Render sits behind a proxy and sets `X-Forwarded-For`, but the Express app
   never calls `app.set('trust proxy', ...)`. Confirmed non-fatal (didn't block any request
   in this session's testing) but worth fixing since it also means the rate limiter may be
   keying on the wrong IP behind Render's proxy, weakening its actual protection.
3. **Confirmed accurate** — Company Admin has no "Add Driver" UI. Verified by grep: no
   `POST /users` call exists anywhere under `client/src/pages/company/`. `POST /users`
   (`role: 'driver'`) is a real, tested, company_admin-only backend endpoint with no
   frontend consumer — same shape as the other Step-5 management-UI gaps, just missed.
4. **Contradicted by direct verification, not adding as stated.** This session's task
   description claimed "School Staff role is missing its core functional pages (trip
   confirmation etc)." `client/src/pages/school-staff/SchoolStaffDashboard.tsx` has a full
   "Pending Custody Confirmations" section (driver name/phone, Confirm button) and a
   "Granted Students" table — not a stub. The prior session (commit range through `2e9f915`)
   verified this live end-to-end: logged trip as `driver1@3bees.test`, confirmed it as
   `jordan@willowcreek.test`, watched status flip from "Awaiting your confirmation" to
   "Complete". If something is actually broken here now, it needs its own fresh live
   reproduction — this entry as originally worded isn't accurate against current code.
5. **Contradicted by direct verification, not adding as stated.** This session's task
   description claimed "School Admin's student view is missing contact info."
   `client/src/pages/school-admin/StudentsPage.tsx` renders `Parent/Guardian` and `Phone`
   columns (`s.parent_name`, `s.parent_phone`) for every row. If "contact info" means
   something more specific (e.g. the linked company's contact, not the parent's), that
   needs to be re-specified — as worded, this item doesn't match current code.
6. [RESOLVED July 18 2026 — see prior session's commit `54b52ee`] Driver dashboard layout
   collapse, Tailwind v4 theme-token collision. Full writeup below.
7. No `GET /schools` endpoint — Students page shows raw ids instead of school names. Full
   writeup below.
8. Live deploy runs off a public mirror repo (`saferoute-tms-deploy`), not the real
   (private) `saferoute-tms` repo — see the deploy session's summary for why (Render's API
   can't clone a private repo without the account owner connecting GitHub via the
   dashboard, an interactive step that couldn't be completed autonomously).
9. [RESOLVED July 19 2026 — see commits `156375d`, `8589c6d`] `trust proxy` not set —
   `express-rate-limit` logged an `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` warning on every
   production request behind Render's proxy, and was keying rate limits off an unreliable
   IP resolution. Fix: `app.set('trust proxy', 3)` in `server/src/app.js`.
   **The "1 hop" assumption commonly cited for Render was checked live and found wrong for
   this deployment, not applied on faith.** A temporary diagnostic (first a console.log,
   switched to exposing it directly in `/health`'s JSON response after Render's log-query
   API proved too slow to check against reliably) captured a real production request's raw
   `X-Forwarded-For`: `"<real client>, <cloudflare edge>, <render internal hop>"` — 3
   entries, not 1. Render fronts this app with Cloudflare (confirmed separately via the
   `Server: cloudflare` header present on every response from both this API and the static
   site) *in addition to* its own internal routing layer. Tested `trust=1` through `trust=4`
   directly against Express's own `req.ip` resolution logic (not just reasoning about it):
   `trust=1` resolved to the Render-internal hop's private `10.x` address (wrong — an
   internal address, not any client); `trust=3` correctly resolved to the real client's
   public IP; `trust=4` also worked (over-trusting by one hop is harmless once the real
   count is met/exceeded, but `3` is the precise, non-inflated value). Deliberately not
   `true` — that would trust the entire `X-Forwarded-For` chain unconditionally, letting a
   client spoof its own IP by prepending fake entries to its own header.
   **Verified live**: (1) confirmed via the same `/health`-exposed diagnostic that `req.ip`
   now resolves to the real client IP, not an internal address; (2) removed the diagnostic,
   redeployed, sent 5 real requests through the search-claimable endpoint, and confirmed
   *zero* `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` warnings in Render's logs afterward (previously
   one per request); (3) confirmed rate limiting still actually works, keyed correctly by
   real IP — hit the search endpoint 60 times from this one real client (no `X-Forwarded-For`
   spoofing) and got a `429` with `ratelimit-limit: 60`, `ratelimit-policy: 60;w=900`,
   matching the configured `RATE_LIMIT_SEARCH_MAX`/window exactly; (4) confirmed no
   collateral damage — logged in successfully as all 4 seed roles (company_admin, driver,
   school_admin, school_staff) and confirmed CORS still correctly allows the production
   frontend origin; `req.ip`/`req.ips` aren't referenced anywhere else in the codebase
   (grepped), so the change's blast radius is exactly rate-limiting, nothing else. 140/140
   tests pass throughout (the test environment sends no `X-Forwarded-For` header, so the
   trust-proxy value doesn't affect it).
   **Caveat for the future, noted in the code comment**: this is a fixed hop count based on
   what Render's infrastructure does *today*. If Render changes its internal routing (adds
   or removes a hop), this would need re-verifying the same way — temporarily exposing
   `req.ip`/the raw header and checking a live request — not just adjusting the number on
   assumption.
   **Also noticed during this session**: Render's log-query API (`GET /v1/logs`) was
   unreliable for checking recent application `console.log` output against in near-real-time
   — repeated identical-looking responses despite new requests, and no visible propagation
   for several minutes in one instance. Exposing diagnostic info directly in an HTTP response
   was far more reliable for this kind of live verification. Not a product bug to fix, just
   a note for future sessions doing similar live checks.

**Note on items 4 and 5 above:** re-read both files fresh and grepped the relevant
components before writing this section, rather than transcribing the task prompt's
claims verbatim — they don't hold up against current code. Not silently going along with
an inaccurate premise, per this project's own established convention (see
`PROJECT_STATE.md` §6 and the addendum in §7 for two earlier instances of the same
principle). Flagged to the user in-session; happy to re-add with corrected wording if
there's a more specific reproduction.

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
