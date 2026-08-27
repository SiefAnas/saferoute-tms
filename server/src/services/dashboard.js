// Company Admin Dashboard aggregates (2026-08-28). Nothing here is a new data concept —
// it's all read-composition over tables that already exist, for the redesigned Dashboard.
const pool = require('../db/pool');

// "Late/absent today" — the real hook flagged back when Skip Pickup / Mark Absent were
// built. Today only, resets daily by construction (both source tables are keyed by
// calendar date) — no acknowledged/cleared state, per instruction to keep this simple.
// Uses the DB's own CURRENT_DATE (not a JS-computed date string) to stay consistent with
// how skip_date/no_show_date were actually written by parentPortal.js/schedule.js.
async function getAbsentToday(req) {
  const { rows: dateRows } = await pool.query('SELECT CURRENT_DATE AS d');
  const today = dateRows[0].d.toISOString().slice(0, 10);

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

module.exports = { getAbsentToday };
