/* eslint-disable camelcase */
// Claim requests replace self-service claiming (security fix, 2026-09-30). Anyone could claim an
// unclaimed placeholder school or company by verifying their OWN email, then read the students
// other companies had attached to it. Now a claim is only a request: who asked, for which
// placeholder, when. It grants nothing until the SafeTurns owner approves it (by hand for now,
// server/scripts/claim-requests.js). Additive only; existing rows are untouched.
exports.up = (pgm) => {
  pgm.createTable('placeholder_claim_requests', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_kind: { type: 'text', notNull: true },
    org_id: { type: 'uuid', notNull: true },
    requester_name: { type: 'text', notNull: true },
    requester_email: { type: 'text', notNull: true },
    requester_phone: { type: 'text' },
    note: { type: 'text' },
    requester_ip: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'pending' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    decided_at: { type: 'timestamptz' },
    decided_by: { type: 'text' },
    decision_note: { type: 'text' },
    created_user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
  });
  pgm.addConstraint('placeholder_claim_requests', 'pcr_org_kind_check', { check: "org_kind IN ('company','school')" });
  pgm.addConstraint('placeholder_claim_requests', 'pcr_status_check', { check: "status IN ('pending','approved','rejected')" });
  pgm.createIndex('placeholder_claim_requests', ['org_kind', 'org_id']);
  pgm.createIndex('placeholder_claim_requests', 'status');
  // One open request per person per placeholder (asking twice doesn't pile up rows).
  pgm.sql("CREATE UNIQUE INDEX pcr_one_pending_per_requester ON placeholder_claim_requests (org_kind, org_id, lower(requester_email)) WHERE status = 'pending'");
};

exports.down = (pgm) => {
  pgm.dropTable('placeholder_claim_requests');
};
