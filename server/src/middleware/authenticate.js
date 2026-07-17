// Authentication: verify the JWT, then re-load the user from the DB so we honor
// is_active immediately and treat the DB (not the token) as the source of truth
// for role/tenant. Attaches req.auth.
const pool = require('../db/pool');
const { verifyJwt } = require('../auth/jwt');
const { tenantTypeForRole } = require('../db/scoped');

module.exports = async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'missing bearer token' });
    }

    let claims;
    try {
      claims = verifyJwt(header.slice(7));
    } catch {
      return res.status(401).json({ error: 'invalid or expired token' });
    }

    const { rows } = await pool.query(
      'SELECT id, role, company_id, school_id, is_active FROM users WHERE id = $1',
      [claims.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'account inactive or not found' });
    }

    const tenantType = tenantTypeForRole(user.role);
    const tenantId = tenantType === 'company' ? user.company_id : user.school_id;
    req.auth = { userId: user.id, role: user.role, tenantType, tenantId };
    next();
  } catch (err) {
    next(err);
  }
};
