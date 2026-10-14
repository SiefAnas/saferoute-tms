/* eslint-disable camelcase */
// Driver sign-in reminder (branch signin-reminder). A push to a driver N minutes before the first
// stop of their run that day, unless they have already signed in (checked in) for that run.
//
//  - companies.signin_reminder_minutes: the company default. NULL = reminders off for everyone.
//  - users.signin_reminder_minutes: a driver's own lead time (NULL = the company default);
//    users.signin_reminder_off: this driver gets none.
//  - signin_reminders_sent: one row per driver, day and run once the reminder went out, so it goes
//    out once (and only once across API instances and the cron job).
exports.up = (pgm) => {
  pgm.addColumns('companies', { signin_reminder_minutes: { type: 'integer' } });
  pgm.addConstraint('companies', 'companies_signin_reminder_range', {
    check: 'signin_reminder_minutes IS NULL OR signin_reminder_minutes BETWEEN 5 AND 240',
  });
  pgm.addColumns('users', {
    signin_reminder_minutes: { type: 'integer' },
    signin_reminder_off: { type: 'boolean', notNull: true, default: false },
  });
  pgm.addConstraint('users', 'users_signin_reminder_range', {
    check: 'signin_reminder_minutes IS NULL OR signin_reminder_minutes BETWEEN 5 AND 240',
  });
  pgm.createTable('signin_reminders_sent', {
    driver_user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    run_date: { type: 'date', notNull: true },
    shift_period: { type: 'text', notNull: true },
    first_stop_time: { type: 'time', notNull: true },
    sent_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('signin_reminders_sent', 'signin_reminders_sent_pk', { primaryKey: ['driver_user_id', 'run_date', 'shift_period'] });
  pgm.addConstraint('signin_reminders_sent', 'signin_reminders_sent_shift_check', { check: "shift_period IN ('morning', 'afternoon')" });
};

exports.down = (pgm) => {
  pgm.dropTable('signin_reminders_sent');
  pgm.dropConstraint('users', 'users_signin_reminder_range');
  pgm.dropColumns('users', ['signin_reminder_minutes', 'signin_reminder_off']);
  pgm.dropConstraint('companies', 'companies_signin_reminder_range');
  pgm.dropColumns('companies', ['signin_reminder_minutes']);
};
