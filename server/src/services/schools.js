// Cross-tenant read (BACKLOG item #7): a company_admin looking up the *names* of schools
// their company already has students at. Deliberately narrow, not a general schools
// directory — only returns schools with an existing student relationship, so this can't be
// used to enumerate/probe arbitrary org names the caller has no relationship with.
//
// Uses the raw pool, not req.db: `schools` has no `company` entry in the scoped accessor's
// TABLE_SCOPE (a company has no tenant column on the schools table — same reason
// src/services/placeholders.js uses the raw pool for its own cross-tenant creates).
const pool = require('../db/pool');

async function listCompanySchools(companyId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT s.id, s.name
       FROM schools s
       JOIN students st ON st.school_id = s.id
      WHERE st.company_id = $1
      ORDER BY s.name`,
    [companyId],
  );
  return rows;
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

module.exports = { listCompanySchools, getCompanySchool };
