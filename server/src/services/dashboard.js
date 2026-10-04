// Company Admin Dashboard aggregates (2026-08-28). Nothing here is a new data concept —
// it's all read-composition over tables that already exist, for the redesigned Dashboard.
const pool = require('../db/pool');

// "Late/absent today" — the real hook flagged back when Skip Pickup / Mark Absent were
// built. Today only, resets daily by construction (both source tables are keyed by
// calendar date) — no acknowledged/cleared state, per instruction to keep this simple.
// "Today" is the company's business date (req.businessDate, its own timezone), the same date
// skip_date / no_show_date are written with (parentPortal.js / schedule.js). School users see each
// row's own company's today (docs/TIMEZONE_SURVEY.md, C1). No CURRENT_DATE, no session timezone.
//
// Extended 2026-09-02 for school_admin/school_staff (§ pickup-confirmation task): pickup_skips
// and pickup_no_shows are company-tenant-only tables (no school_id column at all), so a
// school-tenant caller's req.db can't reach them — same reconciliation issue getTodaySchedule
// already solved for a different query shape. Joins through students on school_id instead,
// raw pool, same precedent as schedule.js. school_staff is further narrowed to their granted
// students (staff_student_access), matching the same least-privilege restriction trips.js
// already applies to that role.
async function getAbsentToday(req) {
  if (req.auth.role === 'company_admin') return getAbsentTodayForCompany(req);
  return getAbsentTodayForSchool(req);
}

async function getAbsentTodayForCompany(req) {
  const today = req.businessDate;

  const [skips, noShows, students] = await Promise.all([
    req.db.findMany('pickup_skips', { where: { skip_date: today } }),
    req.db.findMany('pickup_no_shows', { where: { no_show_date: today } }),
    req.db.findMany('students'),
  ]);
  const nameOf = new Map(students.map((s) => [s.id, s.full_name]));

  // pg returns timestamptz columns as JS Date objects, not strings — normalize to ISO here
  // so both the sort below and the JSON response are consistent (res.json() would otherwise
  // still serialize Dates correctly, but the sort itself needs real strings/comparable values).
  const entries = [
    ...skips.map((s) => ({ student_id: s.student_id, student_name: nameOf.get(s.student_id) ?? 'Unknown', type: 'parent_skipped', at: new Date(s.created_at).toISOString() })),
    ...noShows.map((n) => ({ student_id: n.student_id, student_name: nameOf.get(n.student_id) ?? 'Unknown', type: 'driver_no_show', at: new Date(n.created_at).toISOString() })),
  ];
  entries.sort((a, b) => b.at.localeCompare(a.at));
  return entries;
}

async function getAbsentTodayForSchool(req) {
  const staffFilter = req.auth.role === 'school_staff'
    ? 'AND st.id IN (SELECT student_id FROM staff_student_access WHERE staff_user_id = $2)'
    : '';
  const params = req.auth.role === 'school_staff' ? [req.auth.tenantId, req.auth.userId] : [req.auth.tenantId];
  // A school's students can ride with companies in different zones: each row is "today" by its own
  // company's date, i.e. this request's instant read in that company's timezone.
  params.push(req.now);
  const now = `$${params.length}::timestamptz`;

  const { rows } = await pool.query(
    `SELECT st.id AS student_id, st.full_name AS student_name, 'parent_skipped' AS type, ps.created_at AS at
       FROM pickup_skips ps JOIN students st ON st.id = ps.student_id
       JOIN companies c ON c.id = ps.company_id
      WHERE st.school_id = $1 AND ps.skip_date = (${now} AT TIME ZONE c.timezone)::date ${staffFilter}
     UNION ALL
     SELECT st.id, st.full_name, 'driver_no_show', pns.created_at
       FROM pickup_no_shows pns JOIN students st ON st.id = pns.student_id
       JOIN companies c ON c.id = pns.company_id
      WHERE st.school_id = $1 AND pns.no_show_date = (${now} AT TIME ZONE c.timezone)::date ${staffFilter}
     ORDER BY at DESC`,
    params
  );
  return rows.map((r) => ({ student_id: r.student_id, student_name: r.student_name, type: r.type, at: new Date(r.at).toISOString() }));
}

module.exports = { getAbsentToday };
