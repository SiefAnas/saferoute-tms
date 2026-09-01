// Real enforcement for the 3 assignment invariants (§7 item 3), checked on every
// create/update so an invalid combination can never land in the table regardless of what
// the client sent:
//  - a van cannot be driven by two different drivers over overlapping date ranges
//  - a student cannot be assigned to two different drivers over overlapping date ranges
//  - a driver cannot be recorded as driving two different vans over overlapping date ranges
//    (this is what makes "the van picked must be the van that driver is actually driving"
//    enforceable — the driver's other active rows are the source of truth for their van)
const { HttpError } = require('../errors');

function dayNumber(dateLike) {
  const d = new Date(dateLike);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

// end === null means open-ended/ongoing (matches the schema and every other range check
// in this codebase, e.g. services/schedule.js's "end_date IS NULL OR end_date >= today").
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const aStartNum = dayNumber(aStart);
  const aEndNum = aEnd == null ? Infinity : dayNumber(aEnd);
  const bStartNum = dayNumber(bStart);
  const bEndNum = bEnd == null ? Infinity : dayNumber(bEnd);
  return aStartNum <= bEndNum && bStartNum <= aEndNum;
}

// `others` = every other assignment already in the company (the caller excludes the row
// being edited, if any, before calling this). Throws a 409 on the first conflict found.
function assertNoConflicts(others, candidate) {
  for (const row of others) {
    if (!rangesOverlap(candidate.start_date, candidate.end_date, row.start_date, row.end_date)) continue;
    if (row.van_id === candidate.van_id && row.driver_user_id !== candidate.driver_user_id) {
      throw new HttpError(409, 'That van is already assigned to a different driver during this date range.');
    }
    if (row.student_id === candidate.student_id && row.driver_user_id !== candidate.driver_user_id) {
      throw new HttpError(409, 'That student is already assigned to a different driver during this date range.');
    }
    if (row.driver_user_id === candidate.driver_user_id && row.van_id !== candidate.van_id) {
      throw new HttpError(409, 'That driver is already driving a different van during this date range — pick that van instead.');
    }
  }
}

module.exports = { rangesOverlap, assertNoConflicts };
