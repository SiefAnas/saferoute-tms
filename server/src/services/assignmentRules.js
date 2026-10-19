// The rules for an assignment's fields, shared by routes/assignments.js and the assignments bulk
// import (services/bulkImport.js), so the two can't drift apart.
//
//   normalizeSchedule(input, { partial })  shift, pickup/dropoff times, days: validated, defaulted
//   assertActiveDriver(user)               the user can be put on an assignment as its driver
//   assertAssignable(db, candidate, opts)  student/driver/van belong to the company, no conflicts
const { HttpError } = require('../errors');
const { assertValidTime, normalizeWeekdays } = require('../validate');
const { assertNoConflicts } = require('./assignmentConflicts');

const SHIFT_PERIODS = ['morning', 'afternoon', 'both'];

// Default days for a new assignment (same as the DB default): Monday to Friday.
const MON_TO_FRI = [1, 2, 3, 4, 5];

function assertShiftPeriod(value) {
  if (!SHIFT_PERIODS.includes(value)) throw new HttpError(400, "shift_period must be 'morning', 'afternoon' or 'both'");
}

// Validates the schedule fields of an assignment. A new assignment (partial false) gets the
// defaults for what is missing: both shifts, Monday to Friday, no times. An edit (partial true)
// returns only the keys that were given. A null time clears it.
function normalizeSchedule(input = {}, { partial = false } = {}) {
  const out = {};
  const has = (k) => input[k] !== undefined;
  if (has('shift_period')) {
    assertShiftPeriod(input.shift_period);
    out.shift_period = input.shift_period;
  } else if (!partial) out.shift_period = 'both';
  for (const k of ['pickup_time', 'dropoff_time']) {
    if (has(k)) {
      if (input[k] !== null) assertValidTime(input[k], k);
      out[k] = input[k];
    } else if (!partial) out[k] = null;
  }
  if (has('days_of_week')) out.days_of_week = normalizeWeekdays(input.days_of_week);
  else if (!partial) out.days_of_week = MON_TO_FRI;
  return out;
}

// A user being put on an assignment as its driver (already known to be in the company).
function assertActiveDriver(user) {
  const name = user.full_name || user.email;
  if (user.role !== 'driver') throw new HttpError(400, `${name} has a ${String(user.role).replace('_', ' ')} account, not a driver account.`);
  if (!user.is_active) throw new HttpError(400, `${name}'s account is deactivated. Reactivate it before assigning students to them.`);
}

// `db` is a tenant-scoped accessor (req.db, or createScopedDb over a transaction's client).
// `candidate` is the assignment as it would be saved. Conflicts are only checked when the student,
// driver and van all belong to this company: a foreign id must fail the FK (a 400), not
// spuriously "conflict" with a real row. checkDriver: the driver is being set (a new assignment,
// or a change of driver), so it must be an active driver; leaving an existing driver alone (e.g.
// ending a deactivated driver's assignment) doesn't need it. excludeId: the row being edited.
async function assertAssignable(db, candidate, { checkDriver = true, excludeId = null } = {}) {
  const [van, student, driver] = await Promise.all([
    db.findById('vans', candidate.van_id),
    db.findById('students', candidate.student_id),
    db.findById('users', candidate.driver_user_id),
  ]);
  if (driver && checkDriver) assertActiveDriver(driver);
  if (!van || !student || !driver) return;
  const others = (await db.findMany('assignments', {})).filter((a) => a.id !== excludeId);
  assertNoConflicts(others, candidate);
}

module.exports = { SHIFT_PERIODS, MON_TO_FRI, assertShiftPeriod, normalizeSchedule, assertActiveDriver, assertAssignable };
