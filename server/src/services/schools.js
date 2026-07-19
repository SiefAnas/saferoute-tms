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

module.exports = { listCompanySchools };
