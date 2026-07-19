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

**2026-07-19 addendum #4:** item #7 is resolved; item #8 is only partially resolved — flagging
the gap rather than claiming full success, since the task's own verification step is what
caught it.

Item #7 (`GET /schools`): added, company_admin-only, scoped to schools the caller's company
already has a student at (not a general directory). Wired into the Students page's
"existing school" dropdown. Verified live: `admin@3bees.test` now sees "Willow Creek
Elementary" in that dropdown, not a raw id. 145/145 backend tests.

Item #8 (mirror repo retirement): `saferoute-tms` went public since the mirror was created,
removing the original *clone* blocker, and both Render services were successfully
repointed at the real repo (`PATCH /v1/services/{id}`, same service ids/URLs) — confirmed
via Render's own logs that they now clone from the real repo, and confirmed live (health,
frontend load, one login) that everything still works. **But** the task's own required
check — "confirm a normal push triggers auto-deploy" — failed: pushed a real commit to the
real repo with a plain `git push`, waited ~6 minutes, nothing auto-deployed. Traced this to
no GitHub webhook/App installation existing on the real repo (`GET .../hooks` → `[]`) —
being public unblocks anonymous clones (manual/API-triggered deploys work fine) but not the
push-webhook path, which still needs Render's GitHub App installed via the same interactive
dashboard step that was the original blocker. Per the task's own instruction, the mirror
repo was **not** deleted, since the replacement isn't fully proven. Full writeup, including
what Anas needs to do to get real auto-deploy working, in `BACKLOG.md`. *Update, same day:*
Anas connected GitHub for `saferoute-tms`, and a later session's plain `git push` auto-
deployed both services on its own (Render's own record: `trigger: "new_commit"`) — this
item is now genuinely fully resolved. See `BACKLOG.md` item #8.

**2026-07-19 addendum #5:** item #3 (Add Driver UI) is resolved — see `BACKLOG.md`. Backend
needed nothing new (`POST /users` already existed, already scoped, already tested; added
one previously-uncovered test) and no new invite mechanism was needed (admin-created
accounts are already stamped verified at creation, same as school_admin's existing
Staff & Access page). New "Add Driver" card on `CompanyAdminDashboard.tsx`. Verified live,
full loop: created a real driver as `admin@3bees.test`, logged in *as that driver*
immediately after, landed on a working Driver dashboard; confirmed tenant isolation
directly against the live API from a different company. Toward the end of this session, a
distinct part of `BACKLOG.md` item #8 also got its final confirmation (auto-deploy from a
plain push now genuinely works, after Anas connected GitHub in Render's dashboard).

With #3 resolved, every item in `BACKLOG.md`'s "Known-broken" section is now either
resolved, investigated-with-no-bug-found, or was never accurate to begin with (#4, #5 —
see the note already on those). Flagging rather than silently confirming: this session's
task closing instructions referenced "the parked Stitch design-polish pass" as the one
remaining exception — no such item exists anywhere in this repo (`BACKLOG.md`,
`PROJECT_STATE.md`, or git history). The only "Stitch" reference at all is §4's note that
the Company Admin dashboard deliberately omits the mockup's live-map/fleet-health/alerts
panels — a documented scope decision from Step 4, not a tracked polish-pass item. If one
exists, it isn't written down anywhere I can find, and needs its own entry before a future
session can act on it.

**2026-07-19 addendum #6 — unplanned merge of PR #1 into `main`, audited (report only, no
corrective action taken).** Outside any Claude Code session, Anas and another AI assistant
merged `overnight/deploy-and-finish` into `main` locally (`git merge` + `git push`, not
through GitHub's PR UI) while working on Render's GitHub App permissions — not a deliberate
decision to ship PR #1, a side effect of that other work.

What was actually confirmed (this session, audit only):
- **Exactly what changed**: `main` went from `251d30c` (the last commit before this whole
  multi-session engagement began — "docs: add PROJECT_STATE.md — full handoff snapshot") to
  `a31356d`. Diffed the exact commit-hash sets: the range `251d30c..a31356d` on `main` is
  **byte-for-byte identical** (same commit hashes, not just similar diffs) to
  `overnight/deploy-and-finish`'s own history over that same range. Nothing extra rode
  along, nothing is missing, nothing was reordered or squashed — a clean linear
  fast-forward, confirmed by hash comparison, not assumed.
- **PR #1's actual GitHub state** (queried via the API, not guessed): `state: "closed"`,
  `merged: true`, `merged_at: 2026-07-19T21:27:36Z`, `merged_by: "SiefAnas"`. GitHub
  auto-detected that the direct push to `main` already contained every commit from PR #1
  and closed it as merged on its own — this is standard GitHub behavior for a
  fast-forward push, not something anyone had to click.
- **The two commits in that range not already covered by this file's own session
  addendums** (`12cea0f "test render auto deploy"`, `6153270 "test real render auto
  deploy"`): both are docs-only (`BACKLOG.md`, plus one trailing blank line in
  `README.md`), authored by Anas testing the Render/GitHub connection directly. No code
  changes, no secrets. Scanned the entire merged range for anything secret-looking (`.env`,
  keys, credentials) — the only match is `client/.env.example`, a placeholder template
  file created earlier in this engagement, not a real secret.
- **Is `main`'s current state safe to be live?** Yes, and provably so, not just "probably
  fine": since `main`'s new content is hash-identical to `overnight/deploy-and-finish`,
  and *that* branch is exactly what Render has been deploying and what every prior session
  individually live-verified (driver layout fix, staged registration UX including the
  caught-and-fixed `requestAnimationFrame` regression, `trust proxy` checked against real
  traffic, `GET /schools`, Add Driver UI — all with live browser/API verification recorded
  in `BACKLOG.md`), there is nothing in `main` right now that hasn't already been
  individually tested live. One asymmetry worth noting: this session's own docs edits
  landed as one additional local commit that's on `overnight/deploy-and-finish` (pushed)
  but *not yet* pushed to `origin/main` — deliberately left that way, since advancing
  `main` further is not this session's call to make.
- **Render's deploy target is unaffected by this merge**: both services are configured to
  track the `overnight/deploy-and-finish` branch specifically, not `main`. This merge makes
  the two branches equal in content right now, but does not change what Render actually
  watches — if `main` and `overnight/deploy-and-finish` diverge going forward (e.g.
  something is committed only to `main`), it will not go live on its own.

No revert, force-push, or PR action was taken — this was audit-only, as instructed. Whether
anything needs to be undone (it's not clear anything does — the content is identical to
what's already live and tested) is Anas's call.
