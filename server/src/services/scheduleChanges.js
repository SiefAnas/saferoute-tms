// "Left early" / "staying later" schedule-change log (§ pickup-confirmation task, 2026-09-02;
// revised the same day once live testing showed "staying later" needs the same real effect as
// "left early", not just a notification). school_staff or school_admin logs a same-day change
// for a student. Notifies company_admin, school_admin, the student's currently-assigned
// driver, and the student's linked parent(s). BOTH change types cancel today's scheduled
// afternoon company pickup (the driver shouldn't show up either way: for "left early" the
// student is already gone; for "staying later" the student isn't leaving at the scheduled
// time, so the driver showing up on schedule would be wrong too) by setting today's assignment
// override to skip=true, reusing the existing company_admin-built override mechanism
// (assignment_schedule_overrides), NOT a new parallel "skip" concept. change_type only affects
// which reason/note gets logged and shown, not the actual schedule effect.
//
// Safe to apply as a whole-day skip (not just "afternoon leg") even though
// assignment_schedule_overrides has no separate pickup/dropoff skip flags: by the time staff
// would log either change, the morning dropoff has already happened and is already recorded in
// `trips` — a forward-looking day-level skip has no retroactive effect on it.
const pool = require('../db/pool');
const { HttpError } = require('../errors');
const { notifyCompanyAndSchoolAdmins } = require('./notifications');

const CHANGE_TYPES = ['left_early', 'staying_later'];

function readScope(req) {
  // Same least-privilege pattern as trips.js: school_staff only sees changes for students
  // granted to them; school_admin (and any future full-school-scope role) sees the whole school.
  if (req.auth.role === 'school_staff') {
    return { ownerIn: { column: 'student_id', table: 'staff_student_access', refColumn: 'student_id', match: { staff_user_id: req.auth.userId } } };
  }
  return {};
}

async function listScheduleChangesToday(req) {
  return req.db.findMany('schedule_changes', { ...readScope(req), where: { change_date: new Date().toISOString().slice(0, 10) }, orderBy: 'created_at' });
}

async function logScheduleChange(req, studentId, { change_type, note } = {}) {
  if (!CHANGE_TYPES.includes(change_type)) {
    throw new HttpError(400, `change_type must be one of: ${CHANGE_TYPES.join(', ')}`);
  }
  // students is dual-tenant (company_id + school_id) — a school-tenant req.db read already
  // works here with no special-casing.
  const student = await req.db.findById('students', studentId);
  if (!student) throw new HttpError(404, 'student not found');

  // req.db.insert stamps the caller's own tenant column (school_id, since school_staff/
  // school_admin are school-tenant); company_id is supplied explicitly here (derived from
  // the student, not the actor) — same shape as logTrip's driver (company-tenant) explicitly
  // supplying school_id. The composite FKs on schedule_changes enforce both are consistent
  // with this actual student, not just independently valid ids.
  const row = await req.db.insert('schedule_changes', {
    company_id: student.company_id,
    student_id: studentId,
    change_type,
    note: note ?? null,
    reported_by_user_id: req.auth.userId,
  });

  // Both change types cancel today's scheduled pickup now — see the file header comment.
  const skippedAssignmentId = await applyPickupSkip(req, student);
  const notified = await notifyScheduleChangeLogged(student, change_type, note);

  return { ...row, notified, skipped_assignment_id: skippedAssignmentId };
}

// Cross-tenant write (school-tenant actor modifying a company-owned assignment's schedule
// override) — assignment_schedule_overrides has no school_id column at all (scoped
// company_admin-only, "like its parent assignments"), so req.db can't reach it from a
// school-tenant caller. Raw pool, explicit ownership via the JOIN (only assignments for a
// student at THIS actor's own school), same precedent as placeholders.js's cross-tenant edits.
async function applyPickupSkip(req, student) {
  const { rows } = await pool.query(
    `SELECT a.id, a.company_id
       FROM assignments a
       JOIN students st ON st.id = a.student_id
      WHERE a.student_id = $1 AND st.school_id = $2
        AND a.start_date <= CURRENT_DATE AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
      ORDER BY a.created_at DESC
      LIMIT 1`,
    [student.id, req.auth.tenantId]
  );
  const assignment = rows[0];
  if (!assignment) return null; // no active assignment today, nothing scheduled to skip

  const { rows: existing } = await pool.query(
    `SELECT id FROM assignment_schedule_overrides WHERE assignment_id = $1 AND override_date = CURRENT_DATE`,
    [assignment.id]
  );
  if (existing[0]) {
    await pool.query(`UPDATE assignment_schedule_overrides SET skip = true WHERE id = $1`, [existing[0].id]);
  } else {
    await pool.query(
      `INSERT INTO assignment_schedule_overrides (company_id, assignment_id, override_date, skip)
       VALUES ($1, $2, CURRENT_DATE, true)`,
      [assignment.company_id, assignment.id]
    );
  }
  return assignment.id;
}

// Notifies company_admin + school_admin (via the shared helper) plus the student's currently
// assigned driver and linked parent(s) as extraRecipients — the one recipient set this task
// asks for that no existing helper covers on its own.
async function notifyScheduleChangeLogged(student, changeType, note) {
  const [driverRows, parentRows] = await Promise.all([
    pool.query(
      `SELECT u.email FROM assignments a JOIN users u ON u.id = a.driver_user_id
        WHERE a.student_id = $1 AND a.company_id = $2
          AND a.start_date <= CURRENT_DATE AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
        ORDER BY a.created_at DESC LIMIT 1`,
      [student.id, student.company_id]
    ),
    pool.query(`SELECT u.email FROM parent_students ps JOIN users u ON u.id = ps.parent_user_id WHERE ps.student_id = $1`, [student.id]),
  ]);
  const extraRecipients = [...driverRows.rows.map((r) => r.email), ...parentRows.rows.map((r) => r.email)];

  const label = changeType === 'left_early' ? 'left school early today' : 'is staying later than usual today';
  const subject = `Schedule change for ${student.full_name}: ${changeType === 'left_early' ? 'left early' : 'staying later'}`;
  const text =
    `${student.full_name} ${label}.` +
    (note ? ` Note: ${note}` : '') +
    " Today's scheduled company pickup for this student has been cancelled.";

  return notifyCompanyAndSchoolAdmins(student.company_id, student.school_id, { subject, text, extraRecipients });
}

module.exports = { listScheduleChangesToday, logScheduleChange };
