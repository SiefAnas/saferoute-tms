/* eslint-disable camelcase */
// Account settings (branch account-settings). Additive only; existing rows are untouched.
//  - users.pending_email*: a self-service email change waits here until the link sent to the new
//    address is opened. Only the SHA-256 of the token is stored (same as every other token).
//  - companies.billing_*: read-only plan info for the Billing page. Every company is on the free
//    pilot for now; no payment data is stored anywhere.
//  - companies.closure_*: a company admin's "close account" request. Sets a purge date 30 days
//    out; the purge itself is not built (see docs/ACCOUNT_SETTINGS_QUESTIONS.md).
//  - legal_acceptances: who accepted which version of the Terms / Privacy Policy, when, from where.
//  - usage_snapshots: one row per company per day (server/scripts/snapshot-usage.js).
exports.up = (pgm) => {
  pgm.addColumns('users', {
    pending_email: { type: 'text' },
    pending_email_token_hash: { type: 'text' },
    pending_email_sent_at: { type: 'timestamptz' },
  });
  // A token hash finds exactly one pending change.
  pgm.sql('CREATE UNIQUE INDEX users_pending_email_token_hash_key ON users (pending_email_token_hash) WHERE pending_email_token_hash IS NOT NULL');

  pgm.addColumns('companies', {
    billing_plan: { type: 'text', notNull: true, default: 'pilot' },
    billing_status: { type: 'text', notNull: true, default: 'free' },
    trial_ends_at: { type: 'timestamptz' },
    closure_requested_at: { type: 'timestamptz' },
    closure_purge_at: { type: 'timestamptz' },
    closure_requested_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    closure_undo_token_hash: { type: 'text' },
  });
  // Only the values the code uses today; widen when real plans exist.
  pgm.addConstraint('companies', 'companies_billing_plan_check', { check: "billing_plan IN ('pilot')" });
  pgm.addConstraint('companies', 'companies_billing_status_check', { check: "billing_status IN ('free','closing')" });
  // A closing company has both dates; an open one has neither.
  pgm.addConstraint('companies', 'companies_closure_dates_check', {
    check: '(closure_requested_at IS NULL) = (closure_purge_at IS NULL)',
  });

  pgm.createTable('legal_acceptances', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    // No cascade: a legal record should not vanish as a side effect. The purge design decides.
    user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
    document: { type: 'text', notNull: true },
    version: { type: 'text', notNull: true },
    accepted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    ip: { type: 'text' },
  });
  pgm.addConstraint('legal_acceptances', 'legal_acceptances_document_check', { check: "document IN ('terms','privacy')" });
  pgm.createIndex('legal_acceptances', ['user_id', 'document']);

  pgm.createTable('usage_snapshots', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    company_id: { type: 'uuid', notNull: true, references: 'companies(id)', onDelete: 'CASCADE' },
    captured_on: { type: 'date', notNull: true },
    students: { type: 'integer', notNull: true, default: 0 },
    drivers: { type: 'integer', notNull: true, default: 0 },
    monitors: { type: 'integer', notNull: true, default: 0 },
    vans: { type: 'integer', notNull: true, default: 0 },
    schools: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('usage_snapshots', 'usage_snapshots_company_day_key', { unique: ['company_id', 'captured_on'] });
};

exports.down = (pgm) => {
  pgm.dropTable('usage_snapshots');
  pgm.dropTable('legal_acceptances');
  pgm.dropConstraint('companies', 'companies_closure_dates_check');
  pgm.dropConstraint('companies', 'companies_billing_status_check');
  pgm.dropConstraint('companies', 'companies_billing_plan_check');
  pgm.dropColumns('companies', [
    'billing_plan', 'billing_status', 'trial_ends_at', 'closure_requested_at', 'closure_purge_at',
    'closure_requested_by', 'closure_undo_token_hash',
  ]);
  pgm.sql('DROP INDEX IF EXISTS users_pending_email_token_hash_key');
  pgm.dropColumns('users', ['pending_email', 'pending_email_token_hash', 'pending_email_sent_at']);
};
