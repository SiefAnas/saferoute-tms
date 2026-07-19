# PROJECT_STATE.md — SafeRoute TMS handoff snapshot

*Last verified: 2026-07-18. Every number in this file was re-confirmed live (full test
suite re-run, fresh `tsc`/`vite build`, live Neon query) immediately before writing it —
not pulled from memory of earlier sessions.*

This file is a point-in-time snapshot for picking the project back up. For the durable
source of truth on scope/architecture, see `TMS_PROJECT_SPEC_1.md` (referenced throughout
as "§n"). For known issues/hardening items, see `BACKLOG.md` — this file does not
duplicate it, only points to it.

---

## 1. Quick start

```bash
git clone https://github.com/SiefAnas/saferoute-tms.git
cd saferoute-tms

# Backend
cd server
cp .env.example .env    # then paste your own Neon (or other Postgres) connection string
                         # into DATABASE_URL — see §5 below for what's needed
npm install
npm run migrate:up      # applies all 8 migrations
npm test                # 140/140 against isolated embedded Postgres (no DB config needed)
npm run dev             # http://localhost:4000

# Frontend (separate terminal)
cd client
npm install
npm run dev             # http://localhost:5173
```

Both dev servers are also wired into `.claude/launch.json` (`api`, `client`) for
`preview_start`-based tooling.

---

## 2. Architecture at a glance

- **Stack:** React 19 + TypeScript + Vite 8 + Tailwind v4 + TanStack Query (client) /
  Node + Express + PostgreSQL, no ORM (server).
- **Multi-tenancy:** every company-side table scoped by `company_id`, every school-side
  table by `school_id`; `students`/`trips` carry both (§4). Enforced twice — DB-layer
  composite FKs (Step 1) + app-layer scoped accessor `req.db` (Step 2) that makes an
  unscoped query structurally impossible, not just discouraged.
- **Auth:** JWT, one shared login for all 4 roles (§5.1). Token carries identity only;
  `authenticate` re-derives role/tenant/`is_active`/`email_verified_at` from the DB every
  request, so a stale token can't widen access.
- **Testing convention:** every backend suite spins up its own **embedded PostgreSQL**
  instance (no external DB needed to run `npm test`), each on its own port to avoid a
  Windows port-release race. Neon is only touched by `npm run test:neon` (a separate,
  opt-in smoke check) and by the actual dev server.

---

## 3. Build history (commits, oldest → newest)

### Step 1 — Schema & migrations
| Commit | What |
|---|---|
| `2ed5c49` | Schema + migrations + multi-tenancy guards, 18/18 |

8 migrations total (`server/migrations/`): companies/schools/users/vans/students/
sessions/trips/assignments/staff_student_access/pay_rules/pay_adjustments, plus the
claim + email-verification columns added in Step 3.

### Step 2 — Auth & RBAC middleware
| Commit | What |
|---|---|
| `038e39f` | JWT auth + RBAC + tenant-scoping middleware, 17/17 |

### Step 3 — Core API routes
| Commit | What |
|---|---|
| `578e6ed` | Claim slice: self-serve signup, placeholder claim + email verification, 20/20 |
| `54e6cf3` | Fix: close operate-rights hole after claim takeover |
| `1416986` | docs: BACKLOG.md created |
| `a3134ca` | Placeholder-creation + Vans/Students/Users/Sessions/Assignments/PayRules, 30/30 |
| `bb1bbf8` | Trips: two-way confirmation + 5-min auto-complete, 17/17 |
| `b685263` | docs: mark Step 3 complete |
| `8ca51a0` | Real `npm test` wired up (embedded Postgres suites) + persistent Neon DB |
| `2a8baf6` | docs: backlog cleanup |

### Step 4 — React frontend
| Commit | What |
|---|---|
| `ff798e7` | Scaffold `client/` (Vite+React+TS) + Login, Driver, Company Admin dashboards |
| `0a455ec` | Fix: Vite dev server was IPv6-loopback-only, unreachable from a normal browser |
| `6c455d5` | Self-serve registration on the login page (create-new + claim-existing) |
| `737271f` | Backend: staff-access grants (§7.3) + fix school_staff student-scoping gap, 117/117 |
| `0be3206` | **School Admin/Staff screens (§7.3/§7.4) — built and tested** |
| `698ef75` | Backend hardening pass: resolved 6 of 8 BACKLOG.md items, 136/136 |
| `2e9f915` | Driver contact info (name+phone) on School Staff screen, 140/140 |

**Current HEAD:** `2e9f915`, pushed to `origin/main`, working tree clean.

---

## 4. Frontend — current state, page by page

All pages below are **built, live-tested against real Neon data through the actual UI**
(not just typechecked), not stubs — except where explicitly marked.

| Route | Role | Status | Notes |
|---|---|---|---|
| `/login` | public | ✅ working | Shared login for all 4 roles (§5.1) |
| `/register` | public | ✅ working | Create-new org OR claim-existing (live fuzzy search) |
| `/verify-email` | public | ✅ working | Real token-in-URL flow; resend fallback on failure |
| `/driver` | driver | ✅ working | Check-in/out (+ best-effort GPS), trip logger, today's trips |
| `/company` | company_admin | ✅ working | Live driver status, fleet list, payroll summary |
| `/school-admin` | school_admin | ✅ working | Student search/filter, "Add a Company" placeholder |
| `/school-admin/staff` | school_admin | ✅ working | Create staff, grant/revoke per-student access (checkbox grid) |
| `/school-staff` | school_staff | ✅ working | Granted students, pending confirmations w/ driver name+phone, Confirm button |

**Nothing is stubbed.** The `ComingSoonPage` placeholder that used to cover
school_admin/school_staff was deleted once real pages replaced it (commit `0be3206`).

**Known frontend gaps** (not bugs, just not built — reasonable next steps, not backlogged
since they were never promised for this pass):
- No van/assignment/payroll *management* UI for company_admin (create/edit vans, assign
  students to drivers, set pay rates) — those are all real, tested backend endpoints
  (`/vans`, `/assignments`, `/payroll/rules`) with no frontend yet.
- No student *creation* UI anywhere (backend `POST /students` exists, company_admin-only;
  the seed students were created via direct API calls during testing, not through a form).
- No "forgot password" flow.
- Company Admin dashboard omits the Stitch mockup's live map / fleet-health / alerts
  panels — deliberate, since none of that data exists yet (documented in the Step-4 commit).

---

## 5. Local dev credentials, URLs, ports

### Ports
| Service | Port | URL |
|---|---|---|
| API (Express) | 4000 | http://localhost:4000 |
| Client (Vite) | 5173 | http://localhost:5173 (proxies `/api/*` → :4000, `/api` stripped) |

### Database
- **Live dev DB:** Neon (free tier), PostgreSQL 18.4. Connection string lives in
  `server/.env` (**gitignored, not in git history** — ask Anas for it, or provision your
  own Neon project and run `npm run migrate:up` against it; all 8 migrations are
  idempotent and tracked via `pgmigrations`).
- **Test runs need no DB setup** — `npm test` provisions its own embedded Postgres
  per suite automatically.

### Seed accounts (live on the current Neon DB right now — verified moments ago)
All passwords: **`Secret123!`**

| Email | Role | Org | Notes |
|---|---|---|---|
| `admin@3bees.test` | company_admin | 3 Bees Transportation | Original seed company; has 2 drivers, 2 vans |
| `driver1@3bees.test` | driver | 3 Bees Transportation | Marcus Rodriguez, phone `555-0187`; has trip history |
| `driver2@3bees.test` | driver | 3 Bees Transportation | Sarah Jenkins; no pay rate set (tests the "no rate" UI state) |
| `jamie@greenvalley.test` | company_admin | Green Valley Transport | Created via the live Register flow (fresh-org demo) |
| `principal@willowcreek.test` | school_admin | Willow Creek Elementary | Created via the live claim flow (claim-flow demo) |
| `jordan@willowcreek.test` | school_staff | Willow Creek Elementary | Granted access to 1 of 2 students (Emma Johnson) |

Willow Creek Elementary has 2 students (Emma Johnson grade 3, Liam Carter grade 4), both
linked to 3 Bees Transportation as their company.

### Other
- Dev mailer logs "sent" emails to the API server's console (no real email sends) —
  grep the server output for `[mail]` to find verification tokens/links during manual testing.
- Rate limiting is active against Neon right now (dev server, not `NODE_ENV=test`) at
  generous production-shaped defaults (login 20/15min, signup 20/hr, search 60/15min,
  verify 20/15min) — see `server/src/middleware/rateLimit.js`.

---

## 6. Remaining work, priority order

**Note on this section:** the request that prompted this document said to put "School
Admin/Staff" first as remaining work. That's already built, tested (commit `0be3206`),
and hardened (commits `698ef75`, `2e9f915`) — it's the *last MVP-locked feature that
existed*, not an outstanding one. Flagging the discrepancy rather than silently
reproducing it. All 4 roles' screens are complete. Actual remaining work:

1. **Postgres RLS** *(open decision, in BACKLOG.md)* — optional defense-in-depth on top
   of the already-tested app-layer scoped accessor. Large, invasive change (every table +
   per-request session-variable/role handling in the connection pool). Not started
   pending a go/no-go given its size relative to MVP value.
2. **Real email transport** *(open decision, in BACKLOG.md)* — replacing the dev mailer
   needs external provider credentials (SMTP/Postmark/SendGrid/SES) only Anas can supply.
   The mailer interface is already pluggable; this is a config change, not a rewrite,
   once credentials exist.
3. **Frontend management UI gaps** (§4 above) — van/assignment/payroll-rule management
   and student creation for company_admin; no backend work needed, these endpoints exist
   and are tested.
4. **MVP sign-off** — per the spec's own next-steps (§13): get boss's sign-off on the now-
   much-larger MVP scope, and close the two standing research threads (competitor
   research, legal/compliance research) whenever there's bandwidth.
5. Everything in **v2 backlog** (§9 of the spec) — reporting, notification system,
   billing, per-tenant branding, photo uploads, van maintenance, route optimization —
   deliberately out of scope until MVP ships.

## 7. Known issues / hardening backlog

See **`BACKLOG.md`** — not duplicated here. As of this snapshot: 2 open items (Postgres
RLS, real email transport, both listed above since they're also "remaining work"), 1
item resolved-by-design (company linking), everything else from the Step 3/Trips/Step 4
reviews and the hardening pass resolved and tested.

**2026-07-18 addendum:** a live-deploy bug report (Driver dashboard rendering as a
near-zero-width collapsed column on desktop) was investigated and fixed this session —
see the new "Resolved" entry at the top of `BACKLOG.md` for the root cause (a Tailwind
theme-token naming collision, not a missing responsive breakpoint) and verification.
Note for future reference: this session's task prompt referenced a "Known-broken"
section with a numbered list (this bug as "item #6") that does not exist anywhere in
this repo's history — flagging the mismatch rather than fabricating that section, per
this file's own precedent in §6 above.

**2026-07-19 addendum:** the "Known-broken" section referenced above now genuinely
exists in `BACKLOG.md` (added this session, as explicitly requested). Two of its items
(#4 School Staff, #5 School Admin contact info) were corrected on the spot — they
contradicted current code/prior live testing, so they were annotated rather than
transcribed as fact. Items #1 (registration hang) and #2 (email verification) were
investigated live this session: #2 has no code bug (fully reproduced working end-to-end;
the real user-facing gap is the already-tracked missing real email transport, not a
regression); #1 is real but not infinite (a latency + undifferentiated-loading-state
issue, not a deadlock) and was intentionally left unfixed per the one-fix-per-session
convention — see `BACKLOG.md` for full writeups of both.

**2026-07-19 addendum #2:** item #1 (registration loading UX) is now fixed — see
`BACKLOG.md`'s updated entry. Worth flagging on its own: the first implementation used
`requestAnimationFrame` to sequence a UI transition, and live verification caught that rAF
never fires in a backgrounded browser tab, which would have shipped a *new* hang
indistinguishable from the one being fixed. Caught before this session closed because the
verification step actually watched the live page to completion instead of stopping once
the staged messages appeared in the right order — a reminder that "the messages showed up
correctly" and "the flow actually finishes" are two different checks.

**2026-07-19 addendum #3:** item #9 (`trust proxy`) is now fixed — `app.set('trust proxy',
3)`, not the commonly-assumed `1`. Checked live against a real production request rather
than trusting the "Render = 1 hop" assumption: Render fronts this app with Cloudflare *in
addition to* its own internal routing, so the real `X-Forwarded-For` was 3 hops deep, and
`trust=1` was resolving `req.ip` to Render's own internal private address, not any real
client. Full verification (diagnostic exposed live, warning confirmed gone, rate limiting
confirmed to still trip correctly per real IP, all 4 roles still log in, CORS unchanged) is
in `BACKLOG.md`. Same theme as addendum #2: an assumption that sounded reasonable (single
reverse-proxy hop) didn't hold up against the live system, and checking directly — not
trusting the commonly-cited default — is what caught it.
