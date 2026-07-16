/* eslint-disable camelcase */
// STEP 1 — Foundation: extensions + a shared updated_at trigger function.
// Spec refs: §4 (PostgreSQL, real migrations, UTC timestamps), §7.2 (fuzzy search needs pg_trgm).

exports.up = (pgm) => {
  // gen_random_uuid() for UUID primary keys (§4: SaaS-ready, non-enumerable IDs).
  pgm.createExtension('pgcrypto', { ifNotExists: true });
  // Trigram matching powers the company-scoped fuzzy search (ILIKE + trigram, §7.2).
  pgm.createExtension('pg_trgm', { ifNotExists: true });

  // Reusable trigger function: keep updated_at current on every UPDATE.
  // All timestamps are timestamptz stored in UTC (§4).
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP FUNCTION IF EXISTS set_updated_at();');
  pgm.dropExtension('pg_trgm', { ifExists: true });
  pgm.dropExtension('pgcrypto', { ifExists: true });
};
