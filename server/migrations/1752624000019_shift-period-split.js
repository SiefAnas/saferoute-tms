/* eslint-disable camelcase */
// STEP - Split driver shifts into morning/afternoon (task: shift_period). Adds shift_period
// to sessions, trips, pickup_no_shows, pickup_skips (all nullable - existing rows stay NULL,
// meaning "before the shift split", and the app only ever writes NULL there for old data,
// never for new rows going forward) and to assignments (NOT NULL, existing rows default to
// 'both' via the column default so nothing currently working breaks - one driver doing the
// full day for a student is still the default case).

exports.up = (pgm) => {
  const shiftCheck = "shift_period IS NULL OR shift_period IN ('morning','afternoon')";

  pgm.addColumn('sessions', { shift_period: { type: 'text' } });
  pgm.addConstraint('sessions', 'sessions_shift_period_check', { check: shiftCheck });

  pgm.addColumn('trips', { shift_period: { type: 'text' } });
  pgm.addConstraint('trips', 'trips_shift_period_check', { check: shiftCheck });

  pgm.addColumn('pickup_no_shows', { shift_period: { type: 'text' } });
  pgm.addConstraint('pickup_no_shows', 'pns_shift_period_check', { check: shiftCheck });
  // Was one no-show per (student, date). Now one per (student, date, shift) so morning and
  // afternoon no-shows for the same student on the same day don't collide.
  pgm.dropConstraint('pickup_no_shows', 'pns_unique');
  pgm.addConstraint('pickup_no_shows', 'pns_unique', { unique: ['student_id', 'no_show_date', 'shift_period'] });

  pgm.addColumn('pickup_skips', { shift_period: { type: 'text' } });
  pgm.addConstraint('pickup_skips', 'pickup_skips_shift_period_check', { check: shiftCheck });
  pgm.dropConstraint('pickup_skips', 'pickup_skips_unique');
  pgm.addConstraint('pickup_skips', 'pickup_skips_unique', { unique: ['student_id', 'skip_date', 'shift_period'] });

  // 'both' = current behavior (one driver, full day) so this is backward compatible by
  // default. 'morning'/'afternoon' = a shift-only assignment.
  pgm.addColumn('assignments', { shift_period: { type: 'text', notNull: true, default: 'both' } });
  pgm.addConstraint('assignments', 'assignments_shift_period_check', {
    check: "shift_period IN ('morning','afternoon','both')",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('assignments', 'assignments_shift_period_check');
  pgm.dropColumn('assignments', 'shift_period');

  pgm.dropConstraint('pickup_skips', 'pickup_skips_unique');
  pgm.addConstraint('pickup_skips', 'pickup_skips_unique', { unique: ['student_id', 'skip_date'] });
  pgm.dropConstraint('pickup_skips', 'pickup_skips_shift_period_check');
  pgm.dropColumn('pickup_skips', 'shift_period');

  pgm.dropConstraint('pickup_no_shows', 'pns_unique');
  pgm.addConstraint('pickup_no_shows', 'pns_unique', { unique: ['student_id', 'no_show_date'] });
  pgm.dropConstraint('pickup_no_shows', 'pns_shift_period_check');
  pgm.dropColumn('pickup_no_shows', 'shift_period');

  pgm.dropConstraint('trips', 'trips_shift_period_check');
  pgm.dropColumn('trips', 'shift_period');

  pgm.dropConstraint('sessions', 'sessions_shift_period_check');
  pgm.dropColumn('sessions', 'shift_period');
};
