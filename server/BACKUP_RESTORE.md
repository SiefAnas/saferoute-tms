# Database backup & restore

Daily backups of the live Neon database run automatically via
[`.github/workflows/db-backup.yml`](../.github/workflows/db-backup.yml) — a `pg_dump`
(custom format) uploaded as a GitHub Actions artifact, retained for 90 days. It also
supports manual runs.

## One-time setup

The workflow needs a repo secret it does not otherwise have access to:

1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
2. Name: `DATABASE_URL`
3. Value: the live Neon connection string (same format as `server/.env`'s `DATABASE_URL`,
   including `?sslmode=require`)

Nothing else to configure — the workflow runs daily at 08:00 UTC once the secret exists.

## Running a backup manually

GitHub repo → **Actions → Database Backup → Run workflow**. Or via the CLI:

```bash
gh workflow run db-backup.yml
```

## Downloading a backup

GitHub repo → **Actions → Database Backup** → pick a run → download the
`db-backup-<run-id>` artifact (a `.dump` file inside a zip). Or via the CLI:

```bash
gh run list --workflow=db-backup.yml
gh run download <run-id>
```

## Restoring

The dump is in `pg_dump --format=custom`, restored with `pg_restore`. **Restore into a
scratch database first** — a fresh local Postgres, or a new Neon branch/project — never
directly into the live database, unless you are deliberately recovering from data loss and
have already accepted overwriting current data.

```bash
# Local scratch check, e.g. against docker-compose's db:
createdb -h localhost -U saferoute saferoute_restore_check
pg_restore --no-owner --no-privileges \
  -d postgres://saferoute:saferoute@localhost:5432/saferoute_restore_check \
  saferoute-tms-<timestamp>.dump
```

```bash
# Restoring into a real target (new Neon branch, or the live DB during an actual incident):
pg_restore --no-owner --no-privileges --clean --if-exists \
  -d "$TARGET_DATABASE_URL" \
  saferoute-tms-<timestamp>.dump
```

- `--no-owner --no-privileges` — the dump was taken without role/ownership info (the
  backup role and the restore target's role usually differ); skip them and let the
  target's own roles own the restored objects.
- `--clean --if-exists` — drop existing objects before recreating them, so restoring into
  a database that already has the schema doesn't collide. Omit `--clean` when restoring
  into a genuinely empty database.
- After restoring, run `npm run migrate:up` in `server/` against the target if any
  migrations have landed since the dump was taken — the dump is a snapshot, not a moving
  target.

## Verifying a backup is good (recommended periodically, not just when something breaks)

Restore the latest artifact into a throwaway database (steps above) and spot-check:

```sql
select count(*) from companies;
select count(*) from users;
select count(*) from trips;
```

Compare against what you'd expect from the live app. A backup that restores cleanly and
has plausible row counts is a good backup; one that hasn't been test-restored is unverified.
