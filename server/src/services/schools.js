// Cross-tenant read (BACKLOG item #7): a company_admin looking up the *names* of schools
// their company already has students at. Deliberately narrow, not a general schools
// directory — only returns schools with an existing student relationship, so this can't be
// used to enumerate/probe arbitrary org names the caller has no relationship with.
//
// Uses the raw pool, not req.db: `schools` has no `company` entry in the scoped accessor's
// TABLE_SCOPE (a company has no tenant column on the schools table — same reason
// src/services/placeholders.js uses the raw pool for its own cross-tenant creates).
const pool = require('../db/pool');
const { assignmentNotEndedSql } = require('../db/scoped');

// Also includes school placeholders created by one of this company's own users (POST
// /placeholders/school), even before any student is added there, so a stub the company just
// made shows up in its picker. Same invariant: the company already has a relationship with
// the school (it created it), so this still can't enumerate unrelated schools.
// "This company is linked to school s": it already has a student there, or one of its users
// created the school (a placeholder). The one definition, used by the school picker, the
// student create route and the bulk import.
const LINKED_TO_COMPANY_SQL = `(EXISTS (SELECT 1 FROM students st WHERE st.school_id = s.id AND st.company_id = $1)
         OR EXISTS (SELECT 1 FROM users u WHERE u.id = s.created_by_user_id AND u.company_id = $1))`;

async function listCompanySchools(companyId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.name
       FROM schools s
      WHERE ${LINKED_TO_COMPANY_SQL}
      ORDER BY s.name`,
    [companyId],
  );
  return rows;
}

async function isCompanySchool(companyId, schoolId) {
  const { rows } = await pool.query(`SELECT 1 FROM schools s WHERE s.id = $2 AND ${LINKED_TO_COMPANY_SQL}`, [companyId, schoolId]);
  return rows.length > 0;
}

// Full school detail (name/address/zip/state/phone/hours/website) for a company-side
// caller (company_admin or driver, § Driver dashboard rework) — same narrow invariant as
// listCompanySchools: only reachable if the caller's company actually has a student at
// that school, so this can't be used to probe/enumerate unrelated schools.
async function getCompanySchool(companyId, schoolId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT s.id, s.name, s.address, s.zip_code, s.state, s.phone, s.hours, s.website
       FROM schools s
       JOIN students st ON st.school_id = s.id
      WHERE st.company_id = $1 AND s.id = $2`,
    [companyId, schoolId],
  );
  return rows[0] ?? null;
}

// Driver version of getCompanySchool: only schools of students on the driver's own
// not-ended assignments (the driver access rule, see driverScope in middleware/authorize.js).
async function getDriverSchool(companyId, driverId, schoolId, businessDate) {
  const { rows } = await pool.query(
    `SELECT DISTINCT s.id, s.name, s.address, s.zip_code, s.state, s.phone, s.hours, s.website
       FROM schools s
       JOIN students st ON st.school_id = s.id
       JOIN assignments a ON a.student_id = st.id
      WHERE a.company_id = $1 AND a.driver_user_id = $2 AND s.id = $3
        AND ${assignmentNotEndedSql('a', '$4::date')}`,
    [companyId, driverId, schoolId, businessDate],
  );
  return rows[0] ?? null;
}

module.exports = { LINKED_TO_COMPANY_SQL, listCompanySchools, isCompanySchool, getCompanySchool, getDriverSchool };
