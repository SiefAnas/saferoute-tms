# SafeTurns

© 2026 Anas Sief. All rights reserved.

SafeTurns is a multi-tenant school transportation management system: transport companies run
drivers, monitors, vans and routes; schools confirm pickups and drop-offs; parents follow their
children's rides. Web app (React), mobile app (Expo), API (Node/Express + PostgreSQL).

(Formerly "SafeRoute TMS". Technical names keep `saferoute`: the GitHub repo, the Render
service URLs, the database names, the mobile bundle id / Expo slug / link scheme and the
browser storage keys, so nothing breaks and nobody is signed out.)
Single source of truth for scope/architecture: `TMS_PROJECT_SPEC_1.md` (v2).

> Fresh rewrite of an earlier native-Android prototype, rebuilt as a multi-tenant web SaaS.

## Key docs
- `PENDING.md`: what's left to do right now.
- `V2_ROADMAP.md`: features that are **not** in the MVP (shown as "Coming soon" in the app) and what each needs.
- `API_CONTRACT.md`: the REST API as the code implements it, for the mobile app.
- `BACKLOG.md`: detailed history of decisions and deferred items.

## Repo layout

```
saferoute-tms/
  docker-compose.yml   # local Postgres for development
  server/              # Node/Express API + node-pg-migrate migrations
    migrations/        # STEP 1 — schema (this is what exists so far)
  client/              # React frontend (STEP 4 — not started yet)
```

## Getting a database

You need a running PostgreSQL 13+ (for `gen_random_uuid()` / trigram search). Pick one:

- **Docker (recommended):** `docker compose up -d db` — starts Postgres 16 on `localhost:5432`
  with db/user/password `saferoute` (matches `server/.env.example`).
- **Local install:** install PostgreSQL, then create a db and user and point `DATABASE_URL` at it.
- **Hosted dev db:** e.g. Neon / Supabase — paste its connection string into `DATABASE_URL`.
  It will be refused unless you also set `ALLOW_PRODUCTION_DB=yes` (see below).

### `ALLOW_PRODUCTION_DB` (production guard)

The API, the migration scripts, the seed and the e2e script refuse to run when `DATABASE_URL`
points anywhere but `localhost` / `127.0.0.1` / `::1`. They print the host they were about to reach
and exit. Set `ALLOW_PRODUCTION_DB=yes` (exactly `yes`) only where reaching a remote database is
the point:

- **Render (API service): required**, or the live API refuses to start.
- **A deliberate one-off command** against production, e.g.
  `ALLOW_PRODUCTION_DB=yes npm run migrate:up`.

Don't put it in your local `server/.env`. The rule lives in `server/src/db/productionGuard.js`.

## Running migrations (STEP 1)

```bash
cd server
cp .env.example .env          # then edit DATABASE_URL if needed
npm install
npm run migrate:up            # apply all migrations
npm run migrate:down          # roll back the most recent migration
```

## Support address

`SUPPORT_EMAIL` (server) is the SafeTurns support inbox: **support@safeturns.com**. Data deletion
requests (`POST /users/me/deletion-request`, from drivers, monitors, parents, school admins and
school staff) are emailed there as well as to the admins of the person's company or school. It is
in `server/.env.example` and **must be set on Render**. If it is unset the request is still
recorded and the admins are still emailed, but support is not, and the server logs
`[deletion-request] SUPPORT_EMAIL is not set …` with the request id on every such request.

## Build order (per spec §13)

1. **Schema & migrations** ← current step
2. Auth & RBAC middleware (tenant scoping by `company_id` / `school_id`)
3. Core Express API routes
4. React frontend (reusing the Stitch design system)
  
