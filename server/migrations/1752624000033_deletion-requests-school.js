/* eslint-disable camelcase */
// Deletion requests from school users (branch account-settings). School admins and school staff
// can't close their own account either, so they get the same right to ask as drivers, monitors
// and parents. Their request belongs to a school, not a company:
//  - deletion_requests.company_id becomes nullable and school_id (nullable) is added.
//  - deletion_requests_one_owner: exactly one of the two is set.
// The one-open-request rule (deletion_requests_one_open_per_user) is keyed on user_id, so it
// already covers both shapes. Existing rows all have a company_id and pass the check as they are.
exports.up = (pgm) => {
  pgm.alterColumn('deletion_requests', 'company_id', { notNull: false });
  pgm.addColumns('deletion_requests', {
    school_id: { type: 'uuid', references: 'schools(id)' },
  });
  pgm.addConstraint('deletion_requests', 'deletion_requests_one_owner', {
    check: 'num_nonnulls(company_id, school_id) = 1',
  });
  pgm.createIndex('deletion_requests', 'school_id');
};

// Refuses rather than deleting school users' requests: they are the record of what was asked.
exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM deletion_requests WHERE school_id IS NOT NULL) THEN
        RAISE EXCEPTION 'deletion_requests has rows from school users; handle them before rolling back 033';
      END IF;
    END $$;
  `);
  pgm.dropConstraint('deletion_requests', 'deletion_requests_one_owner');
  pgm.dropIndex('deletion_requests', 'school_id');
  pgm.dropColumns('deletion_requests', ['school_id']);
  pgm.alterColumn('deletion_requests', 'company_id', { notNull: true });
};
