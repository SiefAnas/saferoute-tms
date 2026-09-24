/* eslint-disable camelcase */
// Days of the week an assignment runs (branch assignment-weekdays). ISO weekday numbers, the
// same as Postgres EXTRACT(ISODOW): 1 = Monday ... 7 = Sunday. Default Monday to Friday; the
// column default also fills every existing assignment with Monday to Friday. Never empty.
exports.up = (pgm) => {
  pgm.addColumn('assignments', {
    days_of_week: { type: 'smallint[]', notNull: true, default: pgm.func("'{1,2,3,4,5}'::smallint[]") },
  });
  pgm.addConstraint('assignments', 'assignments_days_of_week_check', {
    check: "cardinality(days_of_week) > 0 AND days_of_week <@ '{1,2,3,4,5,6,7}'::smallint[]",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('assignments', 'assignments_days_of_week_check');
  pgm.dropColumn('assignments', 'days_of_week');
};
