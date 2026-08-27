// Parent role's own portal: which students they're linked to, and the one real (not
// mockup) feature the Parent Dashboard task called out explicitly — "Skip Today's Pickup"
// needs an actual notification, so this is genuine server logic, not a stub.
//
// Eligibility rule (as specified): available until 30 minutes before the student's
// scheduled pickup time, unavailable for the rest of the school day, resets the next day.
// Computed here, server-side and authoritative — the frontend mirrors this rule for the
// button's greyed-out visual state, but this endpoint re-derives and enforces it itself
// rather than trusting the client.
//
// ASSUMPTION, flagged for confirmation: pickup_time (and CURRENT_DATE/now()) are compared
// using the database's own session timezone, with no per-school/per-company timezone
// concept — same implicit-single-timezone handling the rest of the app already has (e.g.
// assignments.pickup_time is a bare `time`, no tz). Not new imprecision introduced by this
// feature, but worth knowing if company/school timezones ever diverge.
const pool = require('../db/pool');
const { HttpError } = require('../errors');
const { notifyCompanyAndSchoolAdmins } = require('./notifications');

function readScope(req) {
  // Every parent read is narrowed to their own linked students — same ownerIn pattern
  // students.js already uses for school_staff's granted-access sub-scope.
  return {
    ownerIn: { column: 'id', table: 'parent_students', refColumn: 'student_id', match: { parent_user_id: req.auth.userId } },
  };
}

async function listMyStudents(req) {
  return req.db.findMany('students', { ...readScope(req), orderBy: 'full_name' });
}

async function assertLinkedStudent(req, studentId) {
  const [student] = await req.db.findMany('students', { ...readScope(req), where: { id: studentId } });
  if (!student) throw new HttpError(404, 'student not found, or not linked to your account');
  return student;
}

// Raw pool, not req.db: needs a date-range join (today's active assignment + today's
// override) that the scoped accessor's equality-only `where` can't express — same
// precedent as schedule.js's getTodaySchedule(). Manually ANDs company_id so this can never
// cross into another company's assignment.
async function getEligibility(companyId, studentId) {
  const { rows } = await pool.query(
    `SELECT a.id AS assignment_id, a.driver_user_id,
            COALESCE(o.pickup_time, a.pickup_time) AS effective_pickup_time,
            COALESCE(o.skip, false) AS override_skip,
            (COALESCE(o.pickup_time, a.pickup_time) IS NOT NULL
              AND now() < ((CURRENT_DATE + COALESCE(o.pickup_time, a.pickup_time))::timestamptz - interval '30 minutes')
            ) AS still_eligible,
            EXISTS(
              SELECT 1 FROM pickup_skips ps WHERE ps.student_id = a.student_id AND ps.skip_date = CURRENT_DATE
            ) AS already_skipped
       FROM assignments a
       LEFT JOIN assignment_schedule_overrides o ON o.assignment_id = a.id AND o.override_date = CURRENT_DATE
      WHERE a.student_id = $1 AND a.company_id = $2
        AND a.start_date <= CURRENT_DATE AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
      ORDER BY a.created_at DESC
      LIMIT 1`,
    [studentId, companyId]
  );
  return rows[0] ?? null;
}

// Real vehicle/driver/trip info for the parent's linked student — replaces the fake data
// the design mockup used, once the real dashboard needed to show it (2026-08-27). Raw pool
// for the same date-range-join reason as getEligibility(); manually ANDs company_id.
async function getStudentDetail(req, studentId) {
  const student = await assertLinkedStudent(req, studentId);

  const { rows: assignmentRows } = await pool.query(
    `SELECT COALESCE(o.pickup_time, a.pickup_time) AS pickup_time,
            COALESCE(o.dropoff_time, a.dropoff_time) AS dropoff_time,
            COALESCE(o.skip, false) AS schedule_skip,
            v.license_plate, v.brand, v.model, v.year, v.color,
            u.full_name AS driver_name, u.phone AS driver_phone,
            c.name AS company_name
       FROM assignments a
       JOIN vans v ON v.id = a.van_id
       JOIN users u ON u.id = a.driver_user_id
       JOIN companies c ON c.id = a.company_id
       LEFT JOIN assignment_schedule_overrides o ON o.assignment_id = a.id AND o.override_date = CURRENT_DATE
      WHERE a.student_id = $1 AND a.company_id = $2
        AND a.start_date <= CURRENT_DATE AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
      ORDER BY a.created_at DESC
      LIMIT 1`,
    [studentId, req.auth.tenantId]
  );
  const assignment = assignmentRows[0] ?? null;

  // skip_today combines the two distinct ways a pickup can be off today: the admin/driver
  // set a full-day schedule override (schedule_skip, driver_dashboard-visible), or the
  // parent used the real Skip Today's Pickup action (pickup_skips) — either means "no
  // pickup needed," which is what the dashboard's status badge/button actually care about.
  const { rows: skipRows } = await pool.query(
    'SELECT 1 FROM pickup_skips WHERE student_id = $1 AND skip_date = CURRENT_DATE',
    [studentId]
  );
  const parentSkipped = skipRows.length > 0;

  const { rows: schoolRows } = await pool.query('SELECT name FROM schools WHERE id = $1', [student.school_id]);

  const { rows: trips } = await pool.query(
    `SELECT trip_type, status, driver_confirmed_at, staff_confirmed_at, completed_at, created_at
       FROM trips
      WHERE student_id = $1 AND company_id = $2
        AND (created_at AT TIME ZONE 'UTC')::date = CURRENT_DATE
      ORDER BY created_at ASC`,
    [studentId, req.auth.tenantId]
  );

  return {
    student: { id: student.id, full_name: student.full_name },
    school: { name: schoolRows[0]?.name ?? null },
    company: { name: assignment?.company_name ?? null },
    van: assignment
      ? { license_plate: assignment.license_plate, brand: assignment.brand, model: assignment.model, year: assignment.year, color: assignment.color }
      : null,
    driver: assignment ? { full_name: assignment.driver_name, phone: assignment.driver_phone } : null,
    pickup_time: assignment?.pickup_time ?? null,
    dropoff_time: assignment?.dropoff_time ?? null,
    skip_today: parentSkipped || (assignment?.schedule_skip ?? false),
    trips_today: trips,
  };
}

async function getSkipStatus(req, studentId) {
  await assertLinkedStudent(req, studentId);
  const elig = await getEligibility(req.auth.tenantId, studentId);
  if (!elig || !elig.effective_pickup_time) {
    return { eligible: false, reason: 'no scheduled pickup today', pickupTime: null, alreadySkipped: false };
  }
  return {
    eligible: Boolean(elig.still_eligible) && !elig.already_skipped && !elig.override_skip,
    reason: elig.already_skipped
      ? 'already skipped today'
      : elig.override_skip
        ? 'pickup already marked skipped today'
        : elig.still_eligible
          ? null
          : 'too close to or past pickup time',
    pickupTime: elig.effective_pickup_time,
    alreadySkipped: Boolean(elig.already_skipped),
  };
}

async function skipPickup(req, studentId) {
  const student = await assertLinkedStudent(req, studentId);
  const elig = await getEligibility(req.auth.tenantId, studentId);
  if (!elig || !elig.effective_pickup_time) throw new HttpError(400, 'no scheduled pickup today for this student');
  if (elig.already_skipped) throw new HttpError(409, "today's pickup was already skipped");
  if (!elig.still_eligible) throw new HttpError(403, 'too late to skip today’s pickup');

  const inserted = await pool.query(
    `INSERT INTO pickup_skips (company_id, student_id, parent_user_id, skip_date)
     VALUES ($1, $2, $3, CURRENT_DATE)
     RETURNING *`,
    [req.auth.tenantId, studentId, req.auth.userId]
  );

  const notified = await notifyPickupSkipped(req, student, elig.driver_user_id);
  return { skipped: true, skip: inserted.rows[0], notified };
}

// Notify the school, the assigned driver, and the company admin — reusing the shared
// notifyCompanyAndSchoolAdmins() helper (also used by the driver no-show feature), which
// reuses sendMail(), the only notification mechanism already built in the app.
async function notifyPickupSkipped(req, student, driverUserId) {
  const [company, driver] = await Promise.all([
    req.db.findById('companies', req.auth.tenantId),
    driverUserId ? req.db.findById('users', driverUserId) : Promise.resolve(null),
  ]);

  const subject = `Pickup skipped today for ${student.full_name}`;
  const text =
    `${student.full_name}'s parent has skipped morning pickup for today ` +
    `(${company?.name ?? 'the transportation company'}). No pickup is needed for this student today.`;

  return notifyCompanyAndSchoolAdmins(req, student.school_id, { subject, text, extraRecipients: driver ? [driver.email] : [] });
}

module.exports = { listMyStudents, getSkipStatus, skipPickup, getStudentDetail };
