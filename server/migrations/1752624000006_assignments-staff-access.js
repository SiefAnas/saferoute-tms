/* eslint-disable camelcase */
// STEP 1 — Assignments (student↔driver↔van, date-ranged) + StaffStudentAccess (static grants). §6.

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
  // Assignments — supports temporary reassignment + history lookback via date range (§6).
  pgm.createTable('assignments', {
    id: uuidPk(pgm),
    company_id: { type: 'uuid', notNull: true },
    student_id: { type: 'uuid', notNull: true },
    driver_user_id: { type: 'uuid', notNull: true },
    van_id: { type: 'uuid', notNull: true },
    start_date: { type: 'date', notNull: true },
    end_date: { type: 'date' }, // null = ongoing
    ...withTimestamps(pgm),
  });
  pgm.addConstraint('assignments', 'assignments_date_range_check', {
    check: 'end_date IS NULL OR end_date >= start_date',
  });
  // Student, driver, and van must all belong to the assignment's company (tenant consistency).
  pgm.addConstraint('assignments', 'assignments_student_company_fk', {
    foreignKeys: {
      columns: ['student_id', 'company_id'],
      references: 'students(id, company_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('assignments', 'assignments_driver_company_fk', {
    foreignKeys: {
      columns: ['driver_user_id', 'company_id'],
      references: 'users(id, company_id)',
      onDelete: 'RESTRICT',
    },
  });
  pgm.addConstraint('assignments', 'assignments_van_company_fk', {
    foreignKeys: {
      columns: ['van_id', 'company_id'],
      references: 'vans(id, company_id)',
      onDelete: 'RESTRICT',
    },
  });
  pgm.createIndex('assignments', 'company_id');
  pgm.createIndex('assignments', 'student_id');
  pgm.createIndex('assignments', 'driver_user_id');
  pgm.createIndex('assignments', 'van_id');
  addUpdatedAtTrigger(pgm, 'assignments');

  // Which School Staff can see which Student, granted by a School Admin. Static, no date range (§6).
  pgm.createTable('staff_student_access', {
    id: uuidPk(pgm),
    staff_user_id: { type: 'uuid', notNull: true },
    student_id: { type: 'uuid', notNull: true },
    school_id: { type: 'uuid', notNull: true },
    granted_by_user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // Both the staff member and the student must belong to the grant's school (tenant consistency).
  pgm.addConstraint('staff_student_access', 'ssa_staff_school_fk', {
    foreignKeys: {
      columns: ['staff_user_id', 'school_id'],
      references: 'users(id, school_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('staff_student_access', 'ssa_student_school_fk', {
    foreignKeys: {
      columns: ['student_id', 'school_id'],
      references: 'students(id, school_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('staff_student_access', 'ssa_unique', {
    unique: ['staff_user_id', 'student_id'],
  });
  pgm.createIndex('staff_student_access', 'student_id');
  pgm.createIndex('staff_student_access', 'school_id');
};

exports.down = (pgm) => {
  pgm.dropTable('staff_student_access');
  pgm.dropTable('assignments');
};
