/* eslint-disable camelcase */
// STEP — Driver-reported no-shows (task: "when they arrive and no one shows up they can hit
// the button the student is Absent"). Real feature, mirrors pickup_skips' shape: one row per
// (student, calendar date), doubling as the double-submit guard. Together, pickup_skips
// (parent-initiated) and pickup_no_shows (driver-initiated) are the two signals a future
// "absent students today" Dashboard stat will be built from — not built yet, per instruction
// to hold off on the Dashboard redesign for now.

const uuidPk = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });

exports.up = (pgm) => {
  pgm.createTable('pickup_no_shows', {
    id: uuidPk(pgm),
    company_id: { type: 'uuid', notNull: true },
    student_id: { type: 'uuid', notNull: true },
    driver_user_id: { type: 'uuid', notNull: true },
    no_show_date: { type: 'date', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('pickup_no_shows', 'pns_student_company_fk', {
    foreignKeys: {
      columns: ['student_id', 'company_id'],
      references: 'students(id, company_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('pickup_no_shows', 'pns_driver_company_fk', {
    foreignKeys: {
      columns: ['driver_user_id', 'company_id'],
      references: 'users(id, company_id)',
      onDelete: 'CASCADE',
    },
  });
  // One no-show report per student per day — also the double-submit guard.
  pgm.addConstraint('pickup_no_shows', 'pns_unique', { unique: ['student_id', 'no_show_date'] });
  pgm.createIndex('pickup_no_shows', 'company_id');
  pgm.createIndex('pickup_no_shows', 'student_id');
};

exports.down = (pgm) => {
  pgm.dropTable('pickup_no_shows');
};
