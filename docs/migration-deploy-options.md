# Running migrations on deploy

Date: 2026-09-30. Report only; nothing was changed on Render, Neon or in the repo.

## How it works today
- The API service on Render (`saferoute-tms-api`) is configured in the Render dashboard. The repo
  has **no `render.yaml`**, so build and start commands live only in the dashboard.
- `server/package.json` start: `node src/index.js`. Nothing in the start path runs migrations.
- Migrations are applied by hand from a laptop (`npm run migrate:up` against Neon). That is how
  `1752624000025` was missed: code that needs the new columns shipped, the schema didn't.
- Deploy triggering: PROJECT_STATE.md (addendum #7, 2026-07-20) recorded that Render's auto-deploy
  on push to `main` **stopped firing** after the branch switch and deploys were triggered by hand.
  I couldn't re-check this without calling Render's API (not allowed in this session).
- Safety net that exists: `.github/workflows/db-backup.yml` takes a daily `pg_dump` of Neon (90-day
  artifacts). Neon's own history (7 days on Launch, 30 on Scale) allows point-in-time restore.

## Facts about the migration tool (node-pg-migrate 7.9.1, read from the installed code)
- **One transaction for the whole run by default** (`--single-transaction`, default true): if any
  pending migration fails, *all* migrations of that run roll back. The database is left exactly as
  before the run. (Migrations that call `pgm.noTransaction()` break this; none of ours do.)
- **Lock:** it takes `pg_try_advisory_lock`. A second concurrent run doesn't wait; it fails
  immediately with "Another migration is already running". Safe, but a second instance starting at
  the same moment will fail its start.
- Our `npm run migrate:up` passes `--envPath .env`. On Render there is no `.env`; that is harmless,
  and `DATABASE_URL` comes from the service's environment.
- The Neon URL in use is a **direct** endpoint (no `-pooler` in the host), which is what advisory
  locks need. If you ever switch the app to the pooled URL, keep a direct URL for migrations.
- Every migration so far is additive except the `down` steps, which drop things (data loss).

## Options

### A. Render "Pre-Deploy Command" (recommended if the service is on a paid instance)
Render runs it after the build and **before** the new version replaces the old one.
- **If a migration fails:** the deploy stops, the **old version keeps serving**, and the database is
  unchanged (single transaction). You see the error in the deploy log. No downtime.
- **If the migration succeeds but the new code then fails its health check:** the old code keeps
  running against the **new** schema. With additive migrations (all of ours) that is fine; with a
  destructive one it isn't (see "Rules" below).
- **Limit:** Pre-deploy commands are only available on **paid instance types** (Starter $7/month
  and up), not on Free. Earlier notes say the API ran on the free tier at least for a while
  (NEXT_STEPS.md, SMTP blocked on free services). Check the instance type first.
- **Risk:** low.

### B. Run migrations in the start command (`npm run migrate:up && npm start`)
Works on the free tier.
- **If a migration fails:** that instance never starts. During a deploy Render keeps the old
  instance until the new one is healthy, so the deploy just fails. But on a **plain restart**
  (free-tier spin-down and wake, a crash, an env var change) there is no old instance: the service
  is **down** until the migration is fixed.
- **Runs on every start:** fast when there's nothing pending (one query), but it adds a DB
  round trip to every free-tier cold start.
- **Two instances starting together:** the second fails the lock and exits, then Render restarts it.
  Fine with one instance, noisy with more.
- **Risk:** medium (a bad migration can take the API down on the next restart).

### C. Run migrations in the build command
The build has the env vars, so it works mechanically.
- The build runs even if the deploy is later cancelled, retried, or its health check fails. You can
  end up with a migrated database and an old app, or a migration run twice by retries (the lock and
  the migrations table make it safe, but the order of events is hard to reason about).
- **Risk:** medium; **not recommended.**

### D. A GitHub Actions workflow runs migrations on push to `main`
Like `db-backup.yml`, with the Neon URL as a repo secret.
- Independent of Render. But nothing ties it to the moment the new code goes live: the app can
  deploy before or after the migration (race), and with auto-deploy unreliable the gap can be long.
- Needs a production DB credential in GitHub (it already has one for backups).
- **If a migration fails:** the workflow goes red and nothing is applied, but the app may
  already be running code that expects the new schema.
- **Risk:** medium (ordering).

### E. Keep it manual, but make a missed migration impossible to miss (add to any option)
At boot (or in `/health`), compare `server/migrations/*` with the `pgmigrations` table. If anything
is pending, log loudly and have `/health` answer 503.
- If Render's health check path is `/health`, a deploy with unapplied migrations **fails** instead
  of silently running broken code.
- **Risk:** very low. This is what would have caught 025.

## Rolling back
1. **The migration failed:** nothing to do in the database (single transaction rolled back).
   Fix the migration, redeploy.
2. **The migration ran, the new code is bad:** roll back the **code** first (Render → Deploys →
   redeploy the previous commit). Additive migrations are safe to leave in place; don't run `down`.
3. **You really must undo a migration:** `npm run migrate:down` (one step) from a laptop against
   Neon. Our `down` steps **drop** columns and tables, so data in them is lost. For 025 that means
   the reset log, saved import mappings and bounce flags.
4. **Data got damaged:** restore with Neon point-in-time restore to just before the deploy, or
   restore a new branch from the daily `pg_dump`, then point the app at it. Take a manual Neon
   branch/snapshot right before any risky migration so there is a named point to go back to.

## Rules that make any option safe
- Migrations stay **additive** (add columns/tables/indexes, backfill). Removing or renaming
  happens in a later, separate deploy, once no running code uses the old shape
  ("expand, then contract").
- Never edit a migration that may already have run anywhere; add a new one.
- Keep the migration numbers unique across branches (see docs/merge-plan.md).

## Recommendation
1. **Now (any plan): Option E.** A pending-migration check that makes `/health` answer 503, plus
   Render's health check path set to `/health`. It stops the exact failure you had, and changes
   nothing about how migrations are run.
2. **Then: Option A if the API is on a paid instance, otherwise Option B**, and plan the move to a
   paid instance (Pre-Deploy is the clean one; free-tier spin-down also hurts the drivers' first
   request of the day).

**Exact config for Option A** (Render dashboard → `saferoute-tms-api` → Settings → Build & Deploy):
- **Pre-Deploy Command:** `npm run migrate:up`
  (use `cd server && npm run migrate:up` if the service's Root Directory is the repo root rather
  than `server`; check the Root Directory field on the same page).
- **Health Check Path:** `/health`
- Leave the Build and Start commands as they are.

**Exact config for Option B** (free tier): set the **Start Command** to
`npm run migrate:up && npm start` (or `cd server && …` as above). No code change is needed.

**Option E** needs a small code change (a pending-migration check in `server/src/app.js`'s
`/health`). It is not made here, as instructed; it would be its own branch with a test.
