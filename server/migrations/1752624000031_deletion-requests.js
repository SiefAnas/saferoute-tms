/* eslint-disable camelcase */
// Data deletion requests (branch account-settings). Drivers, monitors and parents didn't create
// their own accounts, so they can't close them; they can ask. A request is only a record plus
// emails to SafeTurns support and the company admins: nothing is deleted, approved or denied in
// the app yet. Additive only.
exports.up = (pgm) => {
  pgm.createTable('deletion_requests', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    // No cascade: the request is the record of what was asked; the handling decides its fate.
    user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
    company_id: { type: 'uuid', notNull: true, references: 'companies(id)' },
    reason: { type: 'text' },
    requested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    status: { type: 'text', notNull: true, default: 'open' },
    handled_at: { type: 'timestamptz' },
    // Who handled it, as free text (SafeTurns support person or admin), like
    // placeholder_claim_requests.decided_by. Nothing writes it yet.
    handled_by: { type: 'text' },
  });
  pgm.addConstraint('deletion_requests', 'deletion_requests_reason_length', { check: 'reason IS NULL OR char_length(reason) <= 500' });
  // 'open' is the only state the app writes; 'closed' is there so a handled request can be closed
  // by hand and the person can ask again. Widen when the handling is designed.
  pgm.addConstraint('deletion_requests', 'deletion_requests_status_check', { check: "status IN ('open','closed')" });
  pgm.createIndex('deletion_requests', 'company_id');
  // One open request per person at a time.
  pgm.sql("CREATE UNIQUE INDEX deletion_requests_one_open_per_user ON deletion_requests (user_id) WHERE status = 'open'");
};

exports.down = (pgm) => {
  pgm.dropTable('deletion_requests');
};
