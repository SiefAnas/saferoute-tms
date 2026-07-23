// One-off per-date schedule exceptions on an assignment's usual pickup/dropoff time
// (§ Driver dashboard rework). Deliberately NOT a recurring weekly pattern — that system
// is out of scope for now; this is a single day's override (different time, and/or a full
// skip), one row per (assignment, date), upserted by date.
const pool = require('../db/pool');
const { HttpError } = require('../errors');

// Raw pool query (not req.db): "active today" is a date-range condition req.db's
// equality-only `where` can't express — same precedent as payroll.js's summary() and
// services/schools.js's listCompanySchools for tenant-scoped range/join queries. Manually
// ANDs both driver_user_id and company_id so this can never cross into another driver's or
// another company's assignments.
async function getTodaySchedule(req) {
  const { rows } = await pool.query(
    `SELECT a.id AS assignment_id, a.pickup_time, a.dropoff_time,
            st.id AS student_id, st.full_name AS student_name, st.grade,
            st.parent_name, st.parent_phone,
            sc.id AS school_id, sc.name AS school_name,
            o.id AS override_id, o.pickup_time AS override_pickup_time,
            o.dropoff_time AS override_dropoff_time, o.skip AS override_skip, o.note AS override_note
       FROM assignments a
       JOIN students st ON st.id = a.student_id
       JOIN schools sc ON sc.id = st.school_id
       LEFT JOIN assignment_schedule_overrides o
              ON o.assignment_id = a.id AND o.override_date = CURRENT_DATE
      WHERE a.driver_user_id = $1
        AND a.company_id = $2
        AND a.start_date <= CURRENT_DATE
        AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
      ORDER BY st.full_name`,
    [req.auth.userId, req.auth.tenantId]
  );
  return rows.map((r) => ({
    assignment_id: r.assignment_id,
    pickup_time: r.pickup_time,
    dropoff_time: r.dropoff_time,
    student: { id: r.student_id, name: r.student_name, grade: r.grade, parent_name: r.parent_name, parent_phone: r.parent_phone },
    school: { id: r.school_id, name: r.school_name },
    override: r.override_id
      ? { pickup_time: r.override_pickup_time, dropoff_time: r.override_dropoff_time, skip: r.override_skip, note: r.override_note }
      : null,
  }));
}

async function assertOwnedAssignment(req, assignmentId) {
  const assignment = await req.db.findById('assignments', assignmentId);
  if (!assignment) throw new HttpError(404, 'assignment not found');
  return assignment;
}

async function upsertOverride(req, assignmentId, { override_date, pickup_time, dropoff_time, skip, note } = {}) {
  if (!override_date) throw new HttpError(400, 'override_date is required');
  await assertOwnedAssignment(req, assignmentId);

  const data = {
    assignment_id: assignmentId,
    override_date,
    pickup_time: pickup_time ?? null,
    dropoff_time: dropoff_time ?? null,
    skip: skip ?? false,
    note: note ?? null,
  };

  const [existing] = await req.db.findMany('assignment_schedule_overrides', {
    where: { assignment_id: assignmentId, override_date },
  });
  if (existing) return req.db.update('assignment_schedule_overrides', existing.id, data);

  try {
    return await req.db.insert('assignment_schedule_overrides', data);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'an override for this date was just created — please retry');
    throw err;
  }
}

async function listOverrides(req, assignmentId) {
  await assertOwnedAssignment(req, assignmentId);
  return req.db.findMany('assignment_schedule_overrides', {
    where: { assignment_id: assignmentId },
    orderBy: 'override_date',
  });
}

async function deleteOverride(req, assignmentId, overrideId) {
  await assertOwnedAssignment(req, assignmentId);
  const row = await req.db.remove('assignment_schedule_overrides', overrideId, {
    owner: { column: 'assignment_id', value: assignmentId },
  });
  if (!row) throw new HttpError(404, 'override not found');
  return row;
}

module.exports = { getTodaySchedule, upsertOverride, listOverrides, deleteOverride };
