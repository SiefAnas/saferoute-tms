// Resolves the request's business date once, right after authentication (called at the end of
// middleware/authenticate.js), so no service looks it up again (branch company-timezone).
//
//   req.now           the instant this request is handled (time/clock.js, pinnable in tests)
//   req.businessNow   company users: { timeZone, instant, date, time, minutesOfDay } in the
//                     company's zone; null for school users
//   req.businessDate  company users: the company's "today", 'YYYY-MM-DD'; null for school users
//
// School users have no single "today": a school's students can ride with companies in different
// zones, so school-side queries use each row's own company's date (see docs/TIMEZONE_SURVEY.md, C1),
// converting req.now with that company's zone in SQL.
const clock = require('../time/clock');
const { nowInZone, DEFAULT_TIME_ZONE } = require('../time/businessDate');

function attachBusinessDate(req) {
  req.now = clock.now();
  if (req.auth?.tenantType === 'company') {
    req.businessNow = nowInZone(req.auth.companyTimeZone ?? DEFAULT_TIME_ZONE, req.now);
    req.businessDate = req.businessNow.date;
  } else {
    req.businessNow = null;
    req.businessDate = null;
  }
}

module.exports = attachBusinessDate;
