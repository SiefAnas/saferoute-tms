/* eslint-disable camelcase */
// MVP finish: additive only (new nullable columns, no renames or drops).
//  - vans.number: a short fleet number shown as "Van 04". Optional; unique within a company
//    when set (NULLs don't collide, so vans without a number are fine).
//  - companies.email / companies.city: shown and edited on the Company profile page.
exports.up = (pgm) => {
  pgm.addColumn('vans', { number: { type: 'text' } });
  pgm.addConstraint('vans', 'vans_number_length_check', { check: 'number IS NULL OR char_length(number) BETWEEN 1 AND 10' });
  pgm.addConstraint('vans', 'vans_company_number_unique', { unique: ['company_id', 'number'] });

  pgm.addColumn('companies', {
    email: { type: 'text' },
    city: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('companies', ['email', 'city']);
  pgm.dropConstraint('vans', 'vans_company_number_unique');
  pgm.dropConstraint('vans', 'vans_number_length_check');
  pgm.dropColumn('vans', 'number');
};
