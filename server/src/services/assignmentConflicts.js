// Real enforcement for the 3 assignment invariants (§7 item 3), checked on every
// create/update so an invalid combination can never land in the table regardless of what
// the client sent:
//  - a van cannot be driven by two different drivers over overlapping date ranges
//  - a student cannot be assigned to two different drivers over overlapping date ranges
//  - a driver cannot be recorded as driving two different vans over overlapping date ranges
//    (this is what makes "the van picked must be the van that driver is actually driving"
//    enforceable — the driver's other active rows are the source of truth for their van)
const { HttpError } = require('../errors');

// A calendar day as a comparable 'YYYY-MM-DD' string, with no timezone involved (branch
// company-timezone). Two kinds of input arrive here: a 'YYYY-MM-DD' string from the request, and a
// pg DATE column, which node-postgres turns into a JS Date at LOCAL midnight. The old version parsed
// both with new Date() and read local getters, so a string (parsed as UTC midnight) landed on the
// previous day in any process west of UTC and an overlap check could be off by one day.
function dayNumber(dateLike) {
  if (dateLike instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${dateLike.getFullYear()}-${p(dateLike.getMonth() + 1)}-${p(dateLike.getDate())}`;
  }
  return String(dateLike).slice(0, 10);
}

// end === null means open-ended/ongoing (matches the schema and every other range check
// in this codebase, e.g. services/schedule.js's "end_date IS NULL OR end_date >= today").
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  // 'YYYY-MM-DD' strings sort as dates; an open end is later than any date.
  const OPEN = '9999-12-31';
  const aStartDay = dayNumber(aStart);
  const aEndDay = aEnd == null ? OPEN : dayNumber(aEnd);
  const bStartDay = dayNumber(bStart);
  const bEndDay = bEnd == null ? OPEN : dayNumber(bEnd);
  return aStartDay <= bEndDay && bStartDay <= aEndDay;
}

// Whether two assignments' shift_period values could ever cover the same shift.
// 'both' covers everything; 'morning'/'afternoon' only overlap themselves or 'both'.
// (task: a morning-only driver and an afternoon-only driver can share a student.)
// Two assignments only meet on days both run. A missing list (older callers) means the DB
// default, Monday to Friday.
function daysOverlap(a, b) {
  const aDays = a ?? [1, 2, 3, 4, 5];
  const bDays = b ?? [1, 2, 3, 4, 5];
  return aDays.some((d) => bDays.includes(d));
}

function shiftsOverlap(a, b) {
  if (a === 'both' || b === 'both') return true;
  return a === b;
}

// `others` = every other assignment already in the company (the caller excludes the row
// being edited, if any, before calling this). Throws a 409 on the first conflict found.
function assertNoConflicts(others, candidate) {
  for (const row of others) {
    if (!rangesOverlap(candidate.start_date, candidate.end_date, row.start_date, row.end_date)) continue;
    if (!daysOverlap(candidate.days_of_week, row.days_of_week)) continue;
    if (row.van_id === candidate.van_id && row.driver_user_id !== candidate.driver_user_id) {
      throw new HttpError(409, 'That van is already assigned to a different driver during this date range.');
    }
    // Shift-aware: a student can have a morning driver and a separate afternoon driver.
    // Only conflicts when the two assignments' shifts could actually overlap.
    if (
      row.student_id === candidate.student_id &&
      row.driver_user_id !== candidate.driver_user_id &&
      shiftsOverlap(row.shift_period, candidate.shift_period)
    ) {
      throw new HttpError(409, 'That student already has a different driver assigned for an overlapping shift during this date range.');
    }
    if (row.driver_user_id === candidate.driver_user_id && row.van_id !== candidate.van_id) {
      throw new HttpError(409, 'That driver is already driving a different van during this date range. Pick that van instead.');
    }
  }
}

module.exports = { rangesOverlap, shiftsOverlap, daysOverlap, assertNoConflicts };
