// Usage and billing, read only (branch account-settings). No payments: every company is on the
// free pilot. The counts are what the company has in SafeTurns right now:
//   students  every student row of the company (students are never soft-deleted)
//   drivers   active driver accounts (deactivated ones can't sign in or be assigned)
//   monitors  active monitor accounts
//   vans      every van of the company
//   schools   the schools the company works with: the same rule as GET /schools (a school one of
//             its students attends, or a placeholder school it created)
// server/scripts/snapshot-usage.js stores the same numbers once a day in usage_snapshots.
const pool = require('../db/pool');
const { HttpError } = require('../errors');
const { LINKED_TO_COMPANY_SQL } = require('./schools');

const USAGE_SQL = `
  SELECT
    (SELECT count(*)::int FROM students WHERE company_id = $1) AS students,
    (SELECT count(*)::int FROM users WHERE company_id = $1 AND role = 'driver' AND is_active) AS drivers,
    (SELECT count(*)::int FROM users WHERE company_id = $1 AND role = 'monitor' AND is_active) AS monitors,
    (SELECT count(*)::int FROM vans WHERE company_id = $1) AS vans,
    (SELECT count(*)::int FROM schools s WHERE ${LINKED_TO_COMPANY_SQL}) AS schools`;

async function usageCounts(companyId, db = pool) {
  return (await db.query(USAGE_SQL, [companyId])).rows[0];
}

// Shown as "Pilot - free through the end of the year" on the Billing page; the wording lives in
// the client, the API returns the raw values.
async function billing(companyId) {
  const company = (await pool.query('SELECT billing_plan, billing_status, trial_ends_at FROM companies WHERE id = $1', [companyId])).rows[0];
  if (!company) throw new HttpError(404, 'company not found');
  return {
    plan: company.billing_plan,
    status: company.billing_status,
    trial_ends_at: company.trial_ends_at,
    usage: await usageCounts(companyId),
  };
}

module.exports = { USAGE_SQL, usageCounts, billing };
