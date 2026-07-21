/* eslint-disable camelcase */
// Registration rework: address becomes required at the signup app layer (not enforced
// here — see server/src/services/signup.js), and zip/state are new fields. Both columns
// stay nullable at the DB level so this is a pure additive change with no backfill risk
// against existing rows (e.g. "3 Bees Transportation") that predate this migration.
exports.up = (pgm) => {
  pgm.addColumns('companies', { zip_code: { type: 'text' }, state: { type: 'text' } });
  pgm.addColumns('schools', { zip_code: { type: 'text' }, state: { type: 'text' } });
};

exports.down = (pgm) => {
  pgm.dropColumns('companies', ['zip_code', 'state']);
  pgm.dropColumns('schools', ['zip_code', 'state']);
};
