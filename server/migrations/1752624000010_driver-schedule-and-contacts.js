/* eslint-disable camelcase */
// Driver dashboard rework: richer student/school profile fields, a usual pickup/dropoff
// time per assignment, and a one-off per-date override (time change or skip) — the
// lightweight exception mechanism; a full recurring weekly pattern is explicitly deferred.
//
// student_contacts is new: migration 004's comment said "Guardian info is simple fields,
// NOT a separate table" — that decision still holds for the PRIMARY contact
// (students.parent_name/parent_phone, untouched here). This table is for ADDITIONAL
// contacts beyond the primary one (multiple emergency/guardian contacts per student), which
// is a genuinely different need, not a reversal of that decision.

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
  pgm.addColumns('students', {
    age: { type: 'integer' },
    address: { type: 'text' },
    notes: { type: 'text' }, // free-text: e.g. "needs help buckling", "needs a monitor"
  });
  pgm.addConstraint('students', 'students_age_check', {
    check: 'age IS NULL OR (age BETWEEN 0 AND 25)',
  });

  pgm.addColumns('schools', {
    phone: { type: 'text' },
    hours: { type: 'text' }, // free-text operating hours, not structured per-day
    website: { type: 'text' },
  });

  pgm.addColumns('assignments', {
    pickup_time: { type: 'time' },
    dropoff_time: { type: 'time' },
  });
  // Composite-unique target for assignment_schedule_overrides' FK below — assignments
  // predates the composite-unique-target convention other tenant-consistency FKs rely on.
  pgm.addConstraint('assignments', 'assignments_id_company_id_uniq', { unique: ['id', 'company_id'] });

  // Additional contacts beyond the student's primary parent_name/parent_phone.
  pgm.createTable('student_contacts', {
    id: uuidPk(pgm),
    company_id: { type: 'uuid', notNull: true },
    school_id: { type: 'uuid', notNull: true },
    student_id: { type: 'uuid', notNull: true },
    name: { type: 'text', notNull: true },
    phone: { type: 'text' },
    relationship: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('student_contacts', 'student_contacts_company_fk', {
    foreignKeys: { columns: ['student_id', 'company_id'], references: 'students(id, company_id)', onDelete: 'CASCADE' },
  });
  pgm.addConstraint('student_contacts', 'student_contacts_school_fk', {
    foreignKeys: { columns: ['student_id', 'school_id'], references: 'students(id, school_id)', onDelete: 'CASCADE' },
  });
  pgm.createIndex('student_contacts', 'student_id');

  // A single day's exception on an assignment's usual pickup/dropoff time — either a
  // different time and/or a full skip. One row per (assignment, date).
  pgm.createTable('assignment_schedule_overrides', {
    id: uuidPk(pgm),
    company_id: { type: 'uuid', notNull: true },
    assignment_id: { type: 'uuid', notNull: true },
    override_date: { type: 'date', notNull: true },
    pickup_time: { type: 'time' },
    dropoff_time: { type: 'time' },
    skip: { type: 'boolean', notNull: true, default: false },
    note: { type: 'text' },
    ...withTimestamps(pgm),
  });
  pgm.addConstraint('assignment_schedule_overrides', 'aso_assignment_company_fk', {
    foreignKeys: { columns: ['assignment_id', 'company_id'], references: 'assignments(id, company_id)', onDelete: 'CASCADE' },
  });
  pgm.addConstraint('assignment_schedule_overrides', 'aso_unique_per_day', {
    unique: ['assignment_id', 'override_date'],
  });
  pgm.createIndex('assignment_schedule_overrides', 'assignment_id');
  addUpdatedAtTrigger(pgm, 'assignment_schedule_overrides');
};

exports.down = (pgm) => {
  pgm.dropTable('assignment_schedule_overrides');
  pgm.dropTable('student_contacts');
  pgm.dropConstraint('assignments', 'assignments_id_company_id_uniq');
  pgm.dropColumns('assignments', ['pickup_time', 'dropoff_time']);
  pgm.dropColumns('schools', ['phone', 'hours', 'website']);
  pgm.dropConstraint('students', 'students_age_check');
  pgm.dropColumns('students', ['age', 'address', 'notes']);
};
