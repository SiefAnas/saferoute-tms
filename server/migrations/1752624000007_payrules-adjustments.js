/* eslint-disable camelcase */
// STEP 1 — PayRules (per-driver rate) + PayAdjustments (freeform "extra work" line items). §6.
// Money is stored as integer cents, never float (§4).
// PayAdjustments is split out from PayRules: a driver has ONE rate but MANY extra-work entries.

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

exports.up = (pgm) => {
  // Per-driver rate config. rate_type is a genuine per-driver mix, not company-wide (§6).
  pgm.createTable('pay_rules', {
    id: uuidPk(pgm),
    driver_id: { type: 'uuid', notNull: true },
    company_id: { type: 'uuid', notNull: true },
    rate_type: { type: 'text', notNull: true },
    rate_cents: { type: 'integer', notNull: true },
    ...withTimestamps(pgm),
  });
  pgm.addConstraint('pay_rules', 'pay_rules_rate_type_check', {
    check: "rate_type IN ('hourly','daily')",
  });
  pgm.addConstraint('pay_rules', 'pay_rules_rate_nonneg_check', { check: 'rate_cents >= 0' });
  pgm.addConstraint('pay_rules', 'pay_rules_driver_company_fk', {
    foreignKeys: {
      columns: ['driver_id', 'company_id'],
      references: 'users(id, company_id)',
      onDelete: 'CASCADE',
    },
  });
  // One current rate per driver in MVP (rate history is v2).
  pgm.addConstraint('pay_rules', 'pay_rules_driver_uniq', { unique: ['driver_id'] });
  pgm.createIndex('pay_rules', 'company_id');
  addUpdatedAtTrigger(pgm, 'pay_rules');

  // Freeform "extra work" — intentionally uncategorized (overtime-like, one-off tasks,
  // covering a shift, or pure admin judgment). amount_cents may be negative for corrections (§6).
  pgm.createTable('pay_adjustments', {
    id: uuidPk(pgm),
    driver_id: { type: 'uuid', notNull: true },
    company_id: { type: 'uuid', notNull: true },
    amount_cents: { type: 'integer', notNull: true },
    note: { type: 'text', notNull: true },
    work_date: { type: 'date', notNull: true },
    ...withTimestamps(pgm),
  });
  pgm.addConstraint('pay_adjustments', 'pay_adjustments_driver_company_fk', {
    foreignKeys: {
      columns: ['driver_id', 'company_id'],
      references: 'users(id, company_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.createIndex('pay_adjustments', 'company_id');
  pgm.createIndex('pay_adjustments', 'driver_id');
  pgm.createIndex('pay_adjustments', ['driver_id', 'work_date']);
  addUpdatedAtTrigger(pgm, 'pay_adjustments');
};

exports.down = (pgm) => {
  pgm.dropTable('pay_adjustments');
  pgm.dropTable('pay_rules');
};
