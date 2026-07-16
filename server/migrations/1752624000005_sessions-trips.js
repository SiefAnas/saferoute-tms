/* eslint-disable camelcase */
// STEP 1 — Sessions (driver shifts) + Trips (pickup/dropoff w/ two-way confirmation). §6.
// NOTE: "sessions" here = DRIVER SHIFTS, not auth sessions. Auth is JWT (no auth-session table),
// deliberately avoiding a name collision.

const uuidPk = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
const withTimestamps = (pgm) => ({
  created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
});
const addUpdatedAtTrigger = (pgm, table) =>
  pgm.sql(
    `CREATE TRIGGER trg_${table}_updated_at BEFORE UPDATE ON "${table}" ` +
      'FOR EACH ROW EXECUTE FUNCTION set_updated_at();'
  );

exports.up = (pgm) => {
  // Driver shift. If a driver forgets to check out, check_out_at stays NULL forever in MVP
  // (no auto-close, no notifications — both v2, §6).
  pgm.createTable('sessions', {
    id: uuidPk(pgm),
    user_id: { type: 'uuid', notNull: true }, // the driver; tenant-checked via composite FK below
    company_id: { type: 'uuid', notNull: true },
    check_in_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    check_out_at: { type: 'timestamptz' }, // null = still open
    check_in_lat: { type: 'numeric(9,6)' }, // GPS as numeric, never float (§4)
    check_in_lng: { type: 'numeric(9,6)' },
    check_out_lat: { type: 'numeric(9,6)' },
    check_out_lng: { type: 'numeric(9,6)' },
    duration_minutes: { type: 'integer' }, // computed at checkout in the service layer
    trip_count: { type: 'integer', notNull: true, default: 0 },
    ...withTimestamps(pgm),
  });
  // A shift's company MUST equal the driver's company (tenant consistency, enforced by the DB).
  pgm.addConstraint('sessions', 'sessions_user_company_fk', {
    foreignKeys: {
      columns: ['user_id', 'company_id'],
      references: 'users(id, company_id)',
      onDelete: 'RESTRICT',
    },
  });
  pgm.createIndex('sessions', 'company_id');
  pgm.createIndex('sessions', 'user_id');
  // Fast lookup of still-open shifts.
  pgm.sql('CREATE INDEX sessions_open_idx ON sessions (user_id) WHERE check_out_at IS NULL;');
  addUpdatedAtTrigger(pgm, 'sessions');
  pgm.addConstraint('sessions', 'sessions_id_company_id_uniq', { unique: ['id', 'company_id'] });

  // Trip — a single pickup or dropoff inside a shift. Requires a two-way confirmation
  // (driver + school staff). If only one side confirms, service logic auto-completes after 5 min (§6).
  pgm.createTable('trips', {
    id: uuidPk(pgm),
    session_id: { type: 'uuid', notNull: true },
    company_id: { type: 'uuid', notNull: true },
    school_id: { type: 'uuid', notNull: true },
    student_id: { type: 'uuid', notNull: true },
    trip_type: { type: 'text', notNull: true },
    driver_confirmed_at: { type: 'timestamptz' },
    staff_confirmed_at: { type: 'timestamptz' },
    status: { type: 'text', notNull: true, default: 'pending' },
    auto_completed: { type: 'boolean', notNull: true, default: false }, // completed by timeout vs both-confirmed
    completed_at: { type: 'timestamptz' },
    ...withTimestamps(pgm),
  });
  pgm.addConstraint('trips', 'trips_type_check', { check: "trip_type IN ('pickup','dropoff')" });
  pgm.addConstraint('trips', 'trips_status_check', { check: "status IN ('pending','complete')" });
  // Tenant-consistency composite FKs: the trip's company_id must match its session's company,
  // and its company_id + school_id must both match the SAME student's company/school.
  pgm.addConstraint('trips', 'trips_session_company_fk', {
    foreignKeys: {
      columns: ['session_id', 'company_id'],
      references: 'sessions(id, company_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('trips', 'trips_student_company_fk', {
    foreignKeys: {
      columns: ['student_id', 'company_id'],
      references: 'students(id, company_id)',
      onDelete: 'RESTRICT',
    },
  });
  pgm.addConstraint('trips', 'trips_student_school_fk', {
    foreignKeys: {
      columns: ['student_id', 'school_id'],
      references: 'students(id, school_id)',
      onDelete: 'RESTRICT',
    },
  });
  pgm.createIndex('trips', 'company_id');
  pgm.createIndex('trips', 'school_id');
  pgm.createIndex('trips', 'session_id');
  pgm.createIndex('trips', 'student_id');
  // Sweep index for the 5-minute auto-complete job (finds half-confirmed pending trips).
  pgm.sql("CREATE INDEX trips_pending_idx ON trips (status) WHERE status = 'pending';");
  addUpdatedAtTrigger(pgm, 'trips');
};

exports.down = (pgm) => {
  pgm.dropTable('trips');
  pgm.dropTable('sessions');
};
