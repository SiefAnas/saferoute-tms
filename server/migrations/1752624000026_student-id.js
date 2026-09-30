/* eslint-disable camelcase */
// Optional school-issued Student ID. Unique per school when present, compared without case
// ("s-001" and "S-001" are the same ID). Blank is stored as NULL, so any number of students
// can have no ID. Additive only: existing students get NULL.
exports.up = (pgm) => {
  pgm.addColumns('students', { student_id: { type: 'text' } });
  pgm.addConstraint('students', 'students_student_id_length', { check: 'student_id IS NULL OR char_length(student_id) BETWEEN 1 AND 50' });
  pgm.sql('CREATE UNIQUE INDEX students_school_student_id_unique ON students (school_id, lower(student_id)) WHERE student_id IS NOT NULL');
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS students_school_student_id_unique');
  pgm.dropConstraint('students', 'students_student_id_length');
  pgm.dropColumns('students', ['student_id']);
};
