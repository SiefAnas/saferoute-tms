/* eslint-disable camelcase */
// STEP — Payroll page task: "Paid" button that settles the current unpaid cycle. Driver
// work-time tracking already exists (sessions.check_in_at/check_out_at, already used by
// services/payroll.js's summary()) — this only adds the "since when is this unpaid" marker.
// One row per driver already exists in pay_rules (unique on driver_id), so it's the natural
// home for this rather than a new table. NULL = never marked paid (everything since the
// beginning is owed, same as summary()'s existing behavior with no `from`).

exports.up = (pgm) => {
  pgm.addColumn('pay_rules', {
    paid_through_at: { type: 'timestamptz' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('pay_rules', 'paid_through_at');
};
