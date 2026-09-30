/* eslint-disable camelcase */
// Student ID uniqueness moves from "per school" to "per company + school": two transport
// companies serving the same school keep separate records, and one company must not be told that
// another company already uses an ID there. Still case-insensitive; still only when present.
exports.up = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS students_school_student_id_unique');
  pgm.sql('CREATE UNIQUE INDEX students_company_school_student_id_unique ON students (company_id, school_id, lower(student_id)) WHERE student_id IS NOT NULL');
};

// Going back fails if two companies now share an ID at one school; clear one of them first.
exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS students_company_school_student_id_unique');
  pgm.sql('CREATE UNIQUE INDEX students_school_student_id_unique ON students (school_id, lower(student_id)) WHERE student_id IS NOT NULL');
};
