/* eslint-disable camelcase */
// Company timezone (branch company-timezone). Each company's IANA timezone decides its business
// date ("today"), when parents' skip cutoffs pass, and which day payroll counts a shift in
// (server/src/time/businessDate.js). Every existing company gets America/New_York, the zone the
// whole server effectively ran in until now (the database-level setting on Neon). Validity is
// checked on write (PATCH /companies/me), against Intl and pg_timezone_names.
//
// Numbered 032: 030 and 031 are used by the unmerged account-settings and
// prod-safety-and-import-fix branches.
exports.up = (pgm) => {
  pgm.addColumns('companies', {
    timezone: { type: 'text', notNull: true, default: 'America/New_York' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('companies', ['timezone']);
};
