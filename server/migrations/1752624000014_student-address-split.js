/* eslint-disable camelcase */
// STEP — Students page task: split Home address into street/city/state/zip. Both real
// students in the live dev DB have `address` = NULL (checked directly before writing this),
// so nothing is lost by dropping the old free-text column rather than keeping it around
// unused. New columns are NULLABLE at the DB level (no data to backfill, and grade/age/
// parent_name/parent_phone already have real NULLs too) — "required" for these fields,
// per the task, is enforced at the API layer for new creates (server/src/routes/students.js),
// same precedent as the van migration alongside this one and companies/schools' zip/state.

exports.up = (pgm) => {
  pgm.dropColumn('students', 'address');
  pgm.addColumns('students', {
    street_address: { type: 'text' },
    city: { type: 'text' },
    state: { type: 'text' },
    zip_code: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('students', 'zip_code');
  pgm.dropColumn('students', 'state');
  pgm.dropColumn('students', 'city');
  pgm.dropColumn('students', 'street_address');
  pgm.addColumn('students', { address: { type: 'text' } });
};
