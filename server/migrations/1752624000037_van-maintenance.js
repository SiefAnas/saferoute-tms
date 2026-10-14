/* eslint-disable camelcase */
// Van maintenance and fuel (branch van-maintenance).
//
//  - fleet_settings: one row per company. The reminder defaults the admin sets with the first van
//    (days before a date item, miles before a mileage item) and how often drivers are reminded to
//    enter the odometer (days; NULL = off). configured_at is NULL until the admin has set them.
//  - vans.remind_days_before / remind_miles_before: a per-van override; NULL = use the company
//    default, so changing the default never touches a van the admin customized.
//  - maintenance_items: what each van tracks. Built-ins (fleet inspection, 7D inspection, oil
//    change, brake change) are created with every van; the admin adds custom ones. schedule_type
//    'date' (due_date, repeats every interval_days) or 'mileage' (due_miles, repeats every
//    interval_miles). is_active = turned off; deleted_at = deleted (soft, so its history stays).
//    reminded_for / overdue_reminded_for: which due value the "due soon" / "overdue" push already
//    went out for, so each goes out once per cycle (and only once across API instances).
//  - maintenance_records: every "Done", never deleted (audits). Keeps what was due and what comes
//    next.
//  - odometer_entries: fuel / odometer history per van (miles required, gallons and cost
//    optional). The newest entry is the van's current mileage. Admin fixes are stamped.
//  - odometer_reminder_state: when each driver was last reminded to enter miles.
// History tables RESTRICT deletes, so a van or item with records can't silently lose them.
exports.up = (pgm) => {
  pgm.createTable('fleet_settings', {
    company_id: { type: 'uuid', primaryKey: true, references: 'companies(id)', onDelete: 'CASCADE' },
    default_remind_days: { type: 'integer', notNull: true, default: 30 },
    default_remind_miles: { type: 'integer', notNull: true, default: 500 },
    odometer_reminder_days: { type: 'integer' },
    configured_at: { type: 'timestamptz' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('fleet_settings', 'fleet_settings_ranges', {
    check: `default_remind_days BETWEEN 0 AND 365 AND default_remind_miles BETWEEN 0 AND 100000
            AND (odometer_reminder_days IS NULL OR odometer_reminder_days BETWEEN 1 AND 365)`,
  });

  pgm.addColumns('vans', {
    remind_days_before: { type: 'integer' },
    remind_miles_before: { type: 'integer' },
  });
  pgm.addConstraint('vans', 'vans_remind_ranges', {
    check: '(remind_days_before IS NULL OR remind_days_before BETWEEN 0 AND 365) AND (remind_miles_before IS NULL OR remind_miles_before BETWEEN 0 AND 100000)',
  });

  pgm.createTable('maintenance_items', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    company_id: { type: 'uuid', notNull: true },
    van_id: { type: 'uuid', notNull: true },
    name: { type: 'text', notNull: true },
    builtin_key: { type: 'text' }, // fleet_inspection | 7d_inspection | oil_change | brake_change; NULL = custom
    schedule_type: { type: 'text', notNull: true },
    interval_days: { type: 'integer' },
    interval_miles: { type: 'integer' },
    due_date: { type: 'date' },
    due_miles: { type: 'integer' },
    is_active: { type: 'boolean', notNull: true, default: true },
    deleted_at: { type: 'timestamptz' },
    reminded_for: { type: 'text' },
    overdue_reminded_for: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('maintenance_items', 'maintenance_items_van_fk', {
    foreignKeys: { columns: ['van_id', 'company_id'], references: 'vans(id, company_id)', onDelete: 'CASCADE' },
  });
  pgm.addConstraint('maintenance_items', 'maintenance_items_type_check', {
    check: `(schedule_type = 'date' AND due_miles IS NULL AND interval_miles IS NULL)
         OR (schedule_type = 'mileage' AND due_date IS NULL AND interval_days IS NULL)`,
  });
  pgm.addConstraint('maintenance_items', 'maintenance_items_ranges', {
    check: `(interval_days IS NULL OR interval_days BETWEEN 1 AND 3650)
        AND (interval_miles IS NULL OR interval_miles BETWEEN 1 AND 1000000)
        AND (due_miles IS NULL OR due_miles BETWEEN 0 AND 3000000)`,
  });
  pgm.createIndex('maintenance_items', ['van_id']);
  pgm.createIndex('maintenance_items', ['van_id', 'builtin_key'], { unique: true, where: 'builtin_key IS NOT NULL', name: 'maintenance_items_one_builtin_per_van' });
  pgm.sql('CREATE TRIGGER trg_maintenance_items_updated_at BEFORE UPDATE ON "maintenance_items" FOR EACH ROW EXECUTE FUNCTION set_updated_at();');

  pgm.createTable('maintenance_records', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    company_id: { type: 'uuid', notNull: true },
    van_id: { type: 'uuid', notNull: true },
    item_id: { type: 'uuid', notNull: true, references: 'maintenance_items(id)', onDelete: 'RESTRICT' },
    item_name: { type: 'text', notNull: true }, // as it was named when done
    done_date: { type: 'date', notNull: true },
    odometer: { type: 'integer' },
    was_due_date: { type: 'date' },
    was_due_miles: { type: 'integer' },
    next_due_date: { type: 'date' },
    next_due_miles: { type: 'integer' },
    notes: { type: 'text' },
    done_by_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('maintenance_records', 'maintenance_records_van_fk', {
    foreignKeys: { columns: ['van_id', 'company_id'], references: 'vans(id, company_id)', onDelete: 'RESTRICT' },
  });
  pgm.createIndex('maintenance_records', ['van_id', 'done_date']);
  pgm.createIndex('maintenance_records', 'item_id');

  pgm.createTable('odometer_entries', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    company_id: { type: 'uuid', notNull: true },
    van_id: { type: 'uuid', notNull: true },
    entry_date: { type: 'date', notNull: true },
    miles: { type: 'integer', notNull: true },
    gallons: { type: 'numeric(7,2)' },
    cost_cents: { type: 'integer' },
    entered_by_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
    edited_by_user_id: { type: 'uuid', references: 'users(id)' },
    edited_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('odometer_entries', 'odometer_entries_van_fk', {
    foreignKeys: { columns: ['van_id', 'company_id'], references: 'vans(id, company_id)', onDelete: 'RESTRICT' },
  });
  pgm.addConstraint('odometer_entries', 'odometer_entries_ranges', {
    check: 'miles BETWEEN 0 AND 3000000 AND (gallons IS NULL OR gallons > 0) AND (cost_cents IS NULL OR cost_cents >= 0)',
  });
  pgm.createIndex('odometer_entries', ['van_id', 'entry_date', 'created_at']);

  pgm.createTable('odometer_reminder_state', {
    driver_user_id: { type: 'uuid', primaryKey: true, references: 'users(id)', onDelete: 'CASCADE' },
    last_sent_at: { type: 'timestamptz', notNull: true },
  });

  // Every van that already exists gets the four built-ins (nothing due yet: the admin sets dates
  // and mileage targets).
  pgm.sql(`
    INSERT INTO maintenance_items (company_id, van_id, name, builtin_key, schedule_type, interval_days, interval_miles)
    SELECT v.company_id, v.id, b.name, b.key, b.type, b.days, b.miles
      FROM vans v
     CROSS JOIN (VALUES
       ('Fleet inspection', 'fleet_inspection', 'date', 365, NULL::int),
       ('7D inspection', '7d_inspection', 'date', 365, NULL::int),
       ('Oil change', 'oil_change', 'mileage', NULL::int, 5000),
       ('Brake change', 'brake_change', 'mileage', NULL::int, 30000)
     ) AS b(name, key, type, days, miles);
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('odometer_reminder_state');
  pgm.dropTable('odometer_entries');
  pgm.dropTable('maintenance_records');
  pgm.dropTable('maintenance_items');
  pgm.dropConstraint('vans', 'vans_remind_ranges');
  pgm.dropColumns('vans', ['remind_days_before', 'remind_miles_before']);
  pgm.dropTable('fleet_settings');
};
