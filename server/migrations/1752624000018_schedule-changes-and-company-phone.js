/* eslint-disable camelcase */
// School staff/admin pickup-confirmation workflow (2026-09-02):
//  - companies.phone: didn't exist at all — needed so the parent dashboard's "More info"
//    panel can show a real company contact number instead of always being blank.
//  - schedule_changes: a new dual-tenant log table (company_id + school_id, same shape as
//    trips/students) for school_staff/school_admin logging "left early" / "staying later"
//    for a student. Nothing existing fits this: assignment_schedule_overrides is a
//    pre-planned, company_admin-only, whole-day override, not a same-day reactive log with
//    its own notification trail and actor attribution — closer in shape to pickup_skips/
//    pickup_no_shows, just needing two change types instead of one.
const uuidPk = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });

exports.up = (pgm) => {
  pgm.addColumn('companies', { phone: { type: 'text' } });

  pgm.createTable('schedule_changes', {
    id: uuidPk(pgm),
    company_id: { type: 'uuid', notNull: true },
    school_id: { type: 'uuid', notNull: true },
    student_id: { type: 'uuid', notNull: true },
    change_type: { type: 'text', notNull: true },
    note: { type: 'text' },
    reported_by_user_id: { type: 'uuid', notNull: true },
    change_date: { type: 'date', notNull: true, default: pgm.func('CURRENT_DATE') },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('schedule_changes', 'schedule_changes_type_check', {
    check: "change_type IN ('left_early','staying_later')",
  });
  // Tenant-consistency composite FKs, same pattern as trips: company_id + school_id must
  // both match the SAME student's actual company/school (not independently valid ids).
  pgm.addConstraint('schedule_changes', 'schedule_changes_student_company_fk', {
    foreignKeys: { columns: ['student_id', 'company_id'], references: 'students(id, company_id)', onDelete: 'RESTRICT' },
  });
  pgm.addConstraint('schedule_changes', 'schedule_changes_student_school_fk', {
    foreignKeys: { columns: ['student_id', 'school_id'], references: 'students(id, school_id)', onDelete: 'RESTRICT' },
  });
  // Confirms the reporting user actually belongs to the school this row is scoped to.
  pgm.addConstraint('schedule_changes', 'schedule_changes_reporter_school_fk', {
    foreignKeys: { columns: ['reported_by_user_id', 'school_id'], references: 'users(id, school_id)', onDelete: 'RESTRICT' },
  });
  pgm.createIndex('schedule_changes', 'company_id');
  pgm.createIndex('schedule_changes', 'school_id');
  pgm.createIndex('schedule_changes', 'student_id');
};

exports.down = (pgm) => {
  pgm.dropTable('schedule_changes');
  pgm.dropColumn('companies', 'phone');
};
