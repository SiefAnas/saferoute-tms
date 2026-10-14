/* eslint-disable camelcase */
// Monitor stop status (branch monitor-crew-status). What happened at the monitor's stop on one
// run: the driver's "Picked up" / "No show" / "Dropped off", and "Running late" from either side.
//
// Deliberately separate from `sessions` (the monitor's own check-in / check-out, which is what
// their hours and pay come from). Nothing here reads or writes sessions, so pressing these
// buttons can never change anyone's hours.
//
//  - monitor_stops: one row per monitor, per day, per run (morning / afternoon), created the first
//    time anything is pressed. The timestamps are the current state; nothing blocks the run.
//  - monitor_stop_events: every press, in order (who, what, when), as the record.
//  - escalate_at: "Running late" schedules a push to the company admins 4 minutes later (a
//    scheduled sendPush, cancelled by "Picked up" or "No show"); this says when, for the screens.
exports.up = (pgm) => {
  pgm.createTable('monitor_stops', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    company_id: { type: 'uuid', notNull: true, references: 'companies(id)' },
    driver_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
    monitor_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
    run_date: { type: 'date', notNull: true },
    shift_period: { type: 'text', notNull: true },
    picked_up_at: { type: 'timestamptz' },
    no_show_at: { type: 'timestamptz' },
    dropped_off_at: { type: 'timestamptz' },
    late_reported_at: { type: 'timestamptz' },
    late_reported_by: { type: 'text' }, // 'driver' | 'monitor'
    escalate_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('monitor_stops', 'monitor_stops_shift_check', { check: "shift_period IN ('morning', 'afternoon')" });
  pgm.addConstraint('monitor_stops', 'monitor_stops_late_by_check', { check: "late_reported_by IS NULL OR late_reported_by IN ('driver', 'monitor')" });
  pgm.addConstraint('monitor_stops', 'monitor_stops_one_per_run', { unique: ['monitor_user_id', 'run_date', 'shift_period'] });
  pgm.createIndex('monitor_stops', ['driver_user_id', 'run_date']);
  pgm.sql('CREATE TRIGGER trg_monitor_stops_updated_at BEFORE UPDATE ON "monitor_stops" FOR EACH ROW EXECUTE FUNCTION set_updated_at();');

  pgm.createTable('monitor_stop_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    monitor_stop_id: { type: 'uuid', notNull: true, references: 'monitor_stops(id)', onDelete: 'CASCADE' },
    event: { type: 'text', notNull: true },
    actor_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('monitor_stop_events', 'monitor_stop_events_event_check', {
    check: "event IN ('picked_up', 'no_show', 'dropped_off', 'running_late')",
  });
  pgm.createIndex('monitor_stop_events', 'monitor_stop_id');
};

exports.down = (pgm) => {
  pgm.dropTable('monitor_stop_events');
  pgm.dropTable('monitor_stops');
};
