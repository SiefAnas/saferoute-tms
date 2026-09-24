/* eslint-disable camelcase */
// Extra addresses per student (branch stops-and-extra-addresses): "on Fridays, drop off at the
// grandparents'". Each one replaces the home end of a run on the weekdays it lists, for the
// morning pickup, the afternoon drop-off or both, optionally only between two dates. The server
// picks which address applies (services/stops.js); the apps only show what it sends.
// Company-tenant, like the students it belongs to; the composite FK keeps it in the student's
// own company.
exports.up = (pgm) => {
  pgm.createTable('student_extra_addresses', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    company_id: { type: 'uuid', notNull: true },
    student_id: { type: 'uuid', notNull: true },
    label: { type: 'text', notNull: true }, // "Grandparents"
    street_address: { type: 'text', notNull: true },
    city: { type: 'text' },
    state: { type: 'text' },
    zip_code: { type: 'text' },
    days_of_week: { type: 'smallint[]', notNull: true }, // ISO weekdays, 1 = Monday ... 7 = Sunday
    applies_to: { type: 'text', notNull: true }, // 'morning_pickup' | 'afternoon_dropoff' | 'both'
    start_date: { type: 'date' },
    end_date: { type: 'date' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('student_extra_addresses', 'student_extra_addresses_student_fk', {
    foreignKeys: { columns: ['student_id', 'company_id'], references: 'students(id, company_id)', onDelete: 'CASCADE' },
  });
  pgm.addConstraint('student_extra_addresses', 'student_extra_addresses_days_check', {
    check: "cardinality(days_of_week) > 0 AND days_of_week <@ '{1,2,3,4,5,6,7}'::smallint[]",
  });
  pgm.addConstraint('student_extra_addresses', 'student_extra_addresses_applies_check', {
    check: "applies_to IN ('morning_pickup', 'afternoon_dropoff', 'both')",
  });
  pgm.addConstraint('student_extra_addresses', 'student_extra_addresses_dates_check', {
    check: 'end_date IS NULL OR start_date IS NULL OR end_date >= start_date',
  });
  pgm.createIndex('student_extra_addresses', 'student_id');
  pgm.sql(
    'CREATE TRIGGER trg_student_extra_addresses_updated_at BEFORE UPDATE ON "student_extra_addresses" ' +
      'FOR EACH ROW EXECUTE FUNCTION set_updated_at();'
  );
};

exports.down = (pgm) => {
  pgm.dropTable('student_extra_addresses');
};
