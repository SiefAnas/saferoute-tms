# SafeRoute / TMS

Multi-tenant Transportation Management System — React + Node/Express + PostgreSQL.
Single source of truth for scope/architecture: `TMS_PROJECT_SPEC_1.md` (v2).

> Fresh rewrite of an earlier native-Android prototype, rebuilt as a multi-tenant web SaaS.

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

## Running migrations (STEP 1)

```bash
cd server
cp .env.example .env          # then edit DATABASE_URL if needed
npm install
npm run migrate:up            # apply all migrations
npm run migrate:down          # roll back the most recent migration
```

## Build order (per spec §13)

1. **Schema & migrations** ← current step
2. Auth & RBAC middleware (tenant scoping by `company_id` / `school_id`)
3. Core Express API routes
4. React frontend (reusing the Stitch design system)
