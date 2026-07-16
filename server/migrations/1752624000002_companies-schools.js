/* eslint-disable camelcase */
// STEP 1 — Tenants: companies + schools.
// Both are top-level tenants, both self-serve OR created as claimable placeholders (§5.2, §5.3, §6).
// NOTE: created_by_user_id's FK to users is added in the users migration (003) because
// users references these tables back — a circular dependency we break by ordering.

const uuidPk = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
const withTimestamps = (pgm) => ({
  created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
});
const addUpdatedAtTrigger = (pgm, table) =>
  pgm.sql(
    `CREATE TRIGGER trg_${table}_updated_at BEFORE UPDATE ON "${table}" ` +
      'FOR EACH ROW EXECUTE FUNCTION set_updated_at();'
  );

const createTenantTable = (pgm, table) => {
  pgm.createTable(table, {
    id: uuidPk(pgm),
    name: { type: 'text', notNull: true },
    address: { type: 'text' },
    // Claim/placeholder pattern (§5.3): self-serve signups are born 'claimed';
    // placeholders created by the other side stay 'unclaimed' until the real party claims them.
    claim_status: { type: 'text', notNull: true, default: 'claimed' },
    // Who created a placeholder (null for self-serve). FK wired up in 003.
    created_by_user_id: { type: 'uuid' },
    claimed_at: { type: 'timestamptz' },
    ...withTimestamps(pgm),
  });
  pgm.addConstraint(table, `${table}_claim_status_check`, {
    check: "claim_status IN ('claimed','unclaimed')",
  });
  // Fuzzy search on the tenant name (§7.2).
  pgm.sql(`CREATE INDEX ${table}_name_trgm_idx ON ${table} USING gin (name gin_trgm_ops);`);
  addUpdatedAtTrigger(pgm, table);
};

exports.up = (pgm) => {
  createTenantTable(pgm, 'companies');
  createTenantTable(pgm, 'schools');
};

exports.down = (pgm) => {
  pgm.dropTable('schools');
  pgm.dropTable('companies');
};
