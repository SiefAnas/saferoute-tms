/* eslint-disable camelcase */
// STEP 3 (claim slice) — add claim-lifecycle + email-verification support. §5.3.
// - claim_status gains 'pending_claim' (locked-to-one-claimant, awaiting email verify)
// - companies/schools track who claimed + when the pending lock expires (24h TTL)
// - users gain email_verified_at
// - email_verification_tokens stores a HASH of each token (never the raw value)

exports.up = (pgm) => {
  for (const table of ['companies', 'schools']) {
    pgm.addColumns(table, {
      claimed_by_user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
      claim_expires_at: { type: 'timestamptz' }, // pending-claim TTL; null unless pending
    });
    // widen the claim_status CHECK to include the new intermediate state
    pgm.dropConstraint(table, `${table}_claim_status_check`);
    pgm.addConstraint(table, `${table}_claim_status_check`, {
      check: "claim_status IN ('claimed','unclaimed','pending_claim')",
    });
  }

  pgm.addColumns('users', {
    email_verified_at: { type: 'timestamptz' }, // meaningful for claim-path users; null otherwise
  });

  pgm.createTable('email_verification_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    token_hash: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    consumed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('email_verification_tokens', 'evt_token_hash_uniq', { unique: ['token_hash'] });
  pgm.createIndex('email_verification_tokens', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('email_verification_tokens');
  pgm.dropColumns('users', ['email_verified_at']);
  for (const table of ['companies', 'schools']) {
    pgm.dropConstraint(table, `${table}_claim_status_check`);
    pgm.addConstraint(table, `${table}_claim_status_check`, {
      check: "claim_status IN ('claimed','unclaimed')",
    });
    pgm.dropColumns(table, ['claimed_by_user_id', 'claim_expires_at']);
  }
};
