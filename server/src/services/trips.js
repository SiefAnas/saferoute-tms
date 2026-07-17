// Trips (§6, §7.1, §7.4). A trip is one pickup/dropoff of a student in a driver's shift,
// needing two-way confirmation. Design (agreed): the driver LOGGING the trip is the driver's
// half (driver_confirmed_at set at creation), so a pending trip is always awaiting staff.
// If staff doesn't confirm within N minutes, an in-process sweep auto-completes it.
const pool = require('../db/pool');
const { HttpError } = require('../errors');
const { autoCompleteMinutes } = require('../config');

// Read sub-scope by role:
//  - driver      -> trips within their own shifts
//  - school_staff -> trips only for students granted to them (staff_student_access)
//  - admins      -> full tenant scope (no extra filter)
function readScope(req) {
  if (req.auth.role === 'driver') {
    return { ownerIn: { column: 'session_id', table: 'sessions', refColumn: 'id', match: { user_id: req.auth.userId } } };
  }
  if (req.auth.role === 'school_staff') {
    return { ownerIn: { column: 'student_id', table: 'staff_student_access', refColumn: 'student_id', match: { staff_user_id: req.auth.userId } } };
  }
  return {};
}

async function logTrip(req, body = {}) {
  if (req.auth.role !== 'driver') throw new HttpError(403, 'only drivers log trips');
  const { student_id, trip_type } = body;
  if (!student_id || !['pickup', 'dropoff'].includes(trip_type)) {
    throw new HttpError(400, "student_id and trip_type ('pickup'|'dropoff') are required");
  }
  // Must be on an open shift.
  const open = (await req.db.findMany('sessions', { owner: { column: 'user_id', value: req.auth.userId } }))
    .find((s) => s.check_out_at === null);
  if (!open) throw new HttpError(409, 'check in before logging a trip');

  // Student must be in the driver's company; grab its school_id for the trip's denormalized key.
  const student = await req.db.findById('students', student_id);
  if (!student) throw new HttpError(404, 'student not found in your company');

  const trip = await req.db.insert('trips', {
    session_id: open.id,
    student_id,
    school_id: student.school_id,
    trip_type,
    driver_confirmed_at: new Date().toISOString(),
    status: 'pending',
  });
  await pool.query('UPDATE sessions SET trip_count = trip_count + 1 WHERE id = $1 AND company_id = $2', [open.id, req.auth.tenantId]);
  return trip;
}

async function confirmTrip(req, id) {
  if (req.auth.role !== 'school_staff') throw new HttpError(403, 'only school staff confirm custody');
  // findById with the staff grant sub-scope: returns null if the trip isn't for a granted student.
  const trip = await req.db.findById('trips', id, readScope(req));
  if (!trip) throw new HttpError(404, 'trip not found');
  if (trip.status === 'complete') throw new HttpError(409, 'trip already complete');

  const now = new Date().toISOString();
  // Driver half is set at creation, so staff confirmation completes it (both sides present).
  return req.db.update('trips', id, { staff_confirmed_at: now, status: 'complete', completed_at: now });
}

async function listTrips(req) {
  return req.db.findMany('trips', { ...readScope(req), orderBy: 'created_at' });
}

async function getTrip(req, id) {
  const trip = await req.db.findById('trips', id, readScope(req));
  if (!trip) throw new HttpError(404, 'trip not found');
  return trip;
}

// Background sweep: complete half-confirmed trips older than the threshold. System-wide
// (all tenants) since it's a scheduled job, not a user request. Idempotent conditional UPDATE.
async function autoCompleteStaleTrips() {
  const { rowCount } = await pool.query(
    `UPDATE trips
        SET status = 'complete', auto_completed = true, completed_at = now()
      WHERE status = 'pending'
        AND LEAST(COALESCE(driver_confirmed_at, 'infinity'::timestamptz),
                  COALESCE(staff_confirmed_at,  'infinity'::timestamptz))
            < now() - ($1 || ' minutes')::interval`,
    [String(autoCompleteMinutes)]
  );
  return rowCount;
}

module.exports = { logTrip, confirmTrip, listTrips, getTrip, autoCompleteStaleTrips };
