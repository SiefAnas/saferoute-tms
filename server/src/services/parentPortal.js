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

// The parent's own account info (§ parent dashboard mobile task, "More info" -> full parent
// info). AuthUser (the JWT-derived object cached client-side) has no phone/address, and
// there's no other self-read route a parent can hit (users.js is admin-only) — fetched fresh
// here rather than trusting a possibly-stale cached value.
async function getMyProfile(req) {
  const user = await req.db.findById('users', req.auth.userId);
  if (!user) throw new HttpError(404, 'user not found');
  return { full_name: user.full_name, email: user.email, phone: user.phone, address: user.address };
}

async function assertLinkedStudent(req, studentId) {
  const [student] = await req.db.findMany('students', { ...readScope(req), where: { id: studentId } });
  if (!student) throw new HttpError(404, 'student not found, or not linked to your account');
  return student;
}

// Raw pool, not req.db: needs a date-range join (today's active assignment + today's
// override) that the scoped accessor's equality-only `where` can't express — same
// precedent as schedule.js's getTodaySchedule(). Manually ANDs company_id so this can never
// cross into another company's assignment. Returns ALL of the student's active assignments
// today, not just one — a split-shift student has two rows (morning + afternoon).
async function getActiveAssignments(companyId, studentId) {
  const { rows } = await pool.query(
    `SELECT a.id AS assignment_id, a.driver_user_id, a.shift_period,
            COALESCE(o.pickup_time, a.pickup_time) AS effective_pickup_time,
            COALESCE(o.skip, false) AS override_skip,
            (COALESCE(o.pickup_time, a.pickup_time) IS NOT NULL
              AND now() < ((CURRENT_DATE + COALESCE(o.pickup_time, a.pickup_time))::timestamptz - interval '30 minutes')
            ) AS still_eligible
       FROM assignments a
       LEFT JOIN assignment_schedule_overrides o ON o.assignment_id = a.id AND o.override_date = CURRENT_DATE
      WHERE a.student_id = $1 AND a.company_id = $2
        AND a.start_date <= CURRENT_DATE AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
      ORDER BY a.created_at DESC`,
    [studentId, companyId]
  );
  return rows;
}

// Split-shift = the student has two SEPARATE assignments today, one 'morning' and one
// 'afternoon' (different rows, possibly different drivers/vans) — not one 'both' row. Only
// then does the parent get a morning-only vs whole-day choice; a single row (whatever its
// shift_period) keeps the old one-click behavior.
async function getSkipEligibility(companyId, studentId) {
  const assignments = await getActiveAssignments(companyId, studentId);
  const skippedRows = (await pool.query(
    'SELECT shift_period FROM pickup_skips WHERE student_id = $1 AND skip_date = CURRENT_DATE',
    [studentId]
  )).rows;
  const alreadySkippedShifts = new Set(skippedRows.map((r) => r.shift_period));

  const morning = assignments.find((a) => a.shift_period === 'morning');
  const afternoon = assignments.find((a) => a.shift_period === 'afternoon');

  if (morning && afternoon) {
    return {
      isSplit: true,
      morning: { ...morning, alreadySkipped: alreadySkippedShifts.has('morning') },
      afternoon: { ...afternoon, alreadySkipped: alreadySkippedShifts.has('afternoon') },
    };
  }

  const primary = assignments[0] ?? null;
  if (!primary) return { isSplit: false, primary: null };
  // A 'both' assignment (today's default) maps to 'morning', matching this feature's
  // existing copy ("skipped morning pickup"). A genuinely single 'morning'-only or
  // 'afternoon'-only assignment (no split) just uses its own shift.
  const shiftPeriod = primary.shift_period === 'afternoon' ? 'afternoon' : 'morning';
  return {
    isSplit: false,
    primary: { ...primary, shiftPeriod, alreadySkipped: alreadySkippedShifts.has(shiftPeriod) },
  };
}

// Real vehicle/driver/trip info for the parent's linked student — replaces the fake data
// the design mockup used, once the real dashboard needed to show it (2026-08-27). Raw pool
// for the same date-range-join reason as getSkipEligibility(); manually ANDs company_id.
//
// Returns EVERY active assignment as `transport` (shift_period split fix, found during the
// shift_period audit): a split student has a separate morning and afternoon row, each with
// its own driver/van, so picking just one silently hid the other shift's driver entirely.
async function getStudentDetail(req, studentId) {
  const student = await assertLinkedStudent(req, studentId);

  const { rows: assignmentRows } = await pool.query(
    `SELECT a.shift_period,
            COALESCE(o.pickup_time, a.pickup_time) AS pickup_time,
            COALESCE(o.dropoff_time, a.dropoff_time) AS dropoff_time,
            COALESCE(o.skip, false) AS schedule_skip,
            v.license_plate, v.brand, v.model, v.year, v.color,
            u.full_name AS driver_name, u.phone AS driver_phone,
            c.name AS company_name, c.phone AS company_phone
       FROM assignments a
       JOIN vans v ON v.id = a.van_id
       JOIN users u ON u.id = a.driver_user_id
       JOIN companies c ON c.id = a.company_id
       LEFT JOIN assignment_schedule_overrides o ON o.assignment_id = a.id AND o.override_date = CURRENT_DATE
      WHERE a.student_id = $1 AND a.company_id = $2
        AND a.start_date <= CURRENT_DATE AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
      ORDER BY a.shift_period, a.created_at DESC`,
    [studentId, req.auth.tenantId]
  );

  // skip_today combines the two distinct ways a pickup can be off today: the admin/driver
  // set a full-day schedule override (schedule_skip, driver_dashboard-visible), or the
  // parent used the real Skip Today's Pickup action (pickup_skips) — either means "no
  // pickup needed." For a split student, skip_today is only true when EVERY active shift is
  // covered (a genuine whole-day skip); a single shift skipped shows in `transport` instead,
  // since a half-skipped day isn't accurately summarized by one flat badge.
  const { rows: skipRows } = await pool.query(
    'SELECT shift_period FROM pickup_skips WHERE student_id = $1 AND skip_date = CURRENT_DATE',
    [studentId]
  );
  const skippedShifts = new Set(skipRows.map((r) => r.shift_period));
  const allShiftsSkipped =
    assignmentRows.length > 0 &&
    assignmentRows.every((a) => {
      const shift = a.shift_period === 'afternoon' ? 'afternoon' : 'morning';
      return skippedShifts.has(shift) || a.schedule_skip;
    });

  const { rows: schoolRows } = await pool.query('SELECT name FROM schools WHERE id = $1', [student.school_id]);

  const { rows: trips } = await pool.query(
    `SELECT trip_type, status, driver_confirmed_at, staff_confirmed_at, completed_at, created_at
       FROM trips
      WHERE student_id = $1 AND company_id = $2
        AND (created_at AT TIME ZONE 'UTC')::date = CURRENT_DATE
      ORDER BY created_at ASC`,
    [studentId, req.auth.tenantId]
  );

  const first = assignmentRows[0] ?? null;
  return {
    student: { id: student.id, full_name: student.full_name, grade: student.grade },
    school: { name: schoolRows[0]?.name ?? null },
    company: { name: first?.company_name ?? null, phone: first?.company_phone ?? null },
    transport: assignmentRows.map((a) => ({
      shift_period: a.shift_period,
      van: { license_plate: a.license_plate, brand: a.brand, model: a.model, year: a.year, color: a.color },
      driver: { full_name: a.driver_name, phone: a.driver_phone },
      pickup_time: a.pickup_time,
      dropoff_time: a.dropoff_time,
    })),
    skip_today: allShiftsSkipped,
    trips_today: trips,
  };
}

async function getSkipStatus(req, studentId) {
  await assertLinkedStudent(req, studentId);
  const elig = await getSkipEligibility(req.auth.tenantId, studentId);

  if (elig.isSplit) {
    // "Skip morning only" needs morning specifically actionable (not already done, still
    // before its cutoff). "Skip whole day" is offerable as long as NEITHER leg has passed
    // its cutoff without being skipped - a leg already skipped doesn't block it, so a parent
    // who already did "morning only" can come back and add the afternoon leg too.
    const morningOk = elig.morning.alreadySkipped || Boolean(elig.morning.still_eligible);
    const afternoonOk = elig.afternoon.alreadySkipped || Boolean(elig.afternoon.still_eligible);
    const bothAlreadyDone = elig.morning.alreadySkipped && elig.afternoon.alreadySkipped;
    return {
      splitShift: true,
      morningOnly: {
        eligible: !elig.morning.alreadySkipped && Boolean(elig.morning.still_eligible) && !elig.morning.override_skip,
        alreadySkipped: elig.morning.alreadySkipped,
      },
      wholeDay: {
        eligible: !bothAlreadyDone && morningOk && afternoonOk,
        alreadySkipped: bothAlreadyDone,
      },
      pickupTime: elig.morning.effective_pickup_time,
    };
  }

  const p = elig.primary;
  if (!p || !p.effective_pickup_time) {
    return { splitShift: false, eligible: false, reason: 'no scheduled pickup today', pickupTime: null, alreadySkipped: false };
  }
  return {
    splitShift: false,
    eligible: Boolean(p.still_eligible) && !p.alreadySkipped && !p.override_skip,
    reason: p.alreadySkipped
      ? 'already skipped today'
      : p.override_skip
        ? 'pickup already marked skipped today'
        : p.still_eligible
          ? null
          : 'too close to or past pickup time',
    pickupTime: p.effective_pickup_time,
    alreadySkipped: Boolean(p.alreadySkipped),
  };
}

// shift_choice ('morning' | 'whole_day') only matters, and is only required, for a split
// student (separate morning + afternoon assignments). A non-split student (the common case:
// one 'both' row, or a lone shift-only assignment) keeps the old one-click behavior and
// ignores shift_choice entirely - there's nothing to choose between.
async function skipPickup(req, studentId, body = {}) {
  const student = await assertLinkedStudent(req, studentId);
  const elig = await getSkipEligibility(req.auth.tenantId, studentId);

  if (elig.isSplit) {
    const { shift_choice } = body;
    if (!['morning', 'whole_day'].includes(shift_choice)) {
      throw new HttpError(400, "shift_choice must be 'morning' or 'whole_day' for this student");
    }
    const skipAfternoonToo = shift_choice === 'whole_day';

    if (!elig.morning.effective_pickup_time || (skipAfternoonToo && !elig.afternoon.effective_pickup_time)) {
      throw new HttpError(400, 'no scheduled pickup today for this student');
    }
    const bothAlreadyDone = elig.morning.alreadySkipped && (!skipAfternoonToo || elig.afternoon.alreadySkipped);
    if (bothAlreadyDone) throw new HttpError(409, "today's pickup was already skipped");
    if (!elig.morning.alreadySkipped && !elig.morning.still_eligible) throw new HttpError(403, 'too late to skip today’s morning pickup');
    if (skipAfternoonToo && !elig.afternoon.alreadySkipped && !elig.afternoon.still_eligible) {
      throw new HttpError(403, 'too late to skip today’s afternoon pickup');
    }

    const skips = [];
    const driverIds = [];
    // Insert whichever of the two isn't already skipped - lets a parent who already skipped
    // morning come back and add "whole day" without erroring on the already-done half.
    if (!elig.morning.alreadySkipped) {
      const r = await pool.query(
        `INSERT INTO pickup_skips (company_id, student_id, parent_user_id, skip_date, shift_period)
         VALUES ($1, $2, $3, CURRENT_DATE, 'morning') RETURNING *`,
        [req.auth.tenantId, studentId, req.auth.userId]
      );
      skips.push(r.rows[0]);
      driverIds.push(elig.morning.driver_user_id);
    }
    if (skipAfternoonToo && !elig.afternoon.alreadySkipped) {
      const r = await pool.query(
        `INSERT INTO pickup_skips (company_id, student_id, parent_user_id, skip_date, shift_period)
         VALUES ($1, $2, $3, CURRENT_DATE, 'afternoon') RETURNING *`,
        [req.auth.tenantId, studentId, req.auth.userId]
      );
      skips.push(r.rows[0]);
      driverIds.push(elig.afternoon.driver_user_id);
    }

    const company = await req.db.findById('companies', req.auth.tenantId);
    const subject = `Pickup skipped today for ${student.full_name}${skipAfternoonToo ? ' (whole day)' : ' (morning)'}`;
    const text = skipAfternoonToo
      ? `${student.full_name}'s parent has skipped pickup for the whole day today (${company?.name ?? 'the transportation company'}). No pickup is needed for this student today.`
      : `${student.full_name}'s parent has skipped morning pickup for today (${company?.name ?? 'the transportation company'}). The afternoon ride is unaffected.`;
    const notified = await notifyPickupSkipped(req, student, driverIds, subject, text);
    return { skipped: true, skips, notified };
  }

  // Non-split: original single-shift behavior.
  const p = elig.primary;
  if (!p || !p.effective_pickup_time) throw new HttpError(400, 'no scheduled pickup today for this student');
  if (p.alreadySkipped) throw new HttpError(409, "today's pickup was already skipped");
  if (!p.still_eligible) throw new HttpError(403, 'too late to skip today’s pickup');

  const inserted = await pool.query(
    `INSERT INTO pickup_skips (company_id, student_id, parent_user_id, skip_date, shift_period)
     VALUES ($1, $2, $3, CURRENT_DATE, $4)
     RETURNING *`,
    [req.auth.tenantId, studentId, req.auth.userId, p.shiftPeriod]
  );

  const company = await req.db.findById('companies', req.auth.tenantId);
  const subject = `Pickup skipped today for ${student.full_name}`;
  const text =
    `${student.full_name}'s parent has skipped ${p.shiftPeriod} pickup for today ` +
    `(${company?.name ?? 'the transportation company'}). No pickup is needed for this student today.`;
  const notified = await notifyPickupSkipped(req, student, [p.driver_user_id], subject, text);
  return { skipped: true, skips: [inserted.rows[0]], notified };
}

// Notify the school, the assigned driver(s), and the company admin — reusing the shared
// notifyCompanyAndSchoolAdmins() helper (also used by the driver no-show feature), which
// reuses sendMail(), the only notification mechanism already built in the app. Takes an
// array of driver ids (not just one) since a whole-day skip on a split student has two
// different drivers, both of whom need to know, not just one.
async function notifyPickupSkipped(req, student, driverUserIds, subject, text) {
  const uniqueDriverIds = [...new Set(driverUserIds.filter(Boolean))];
  const drivers = await Promise.all(uniqueDriverIds.map((id) => req.db.findById('users', id)));
  const driverEmails = drivers.filter(Boolean).map((d) => d.email);
  return notifyCompanyAndSchoolAdmins(req.auth.tenantId, student.school_id, { subject, text, extraRecipients: driverEmails });
}

module.exports = { listMyStudents, getMyProfile, getSkipStatus, skipPickup, getStudentDetail };
