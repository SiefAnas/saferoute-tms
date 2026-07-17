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
      `SELECT u.id, u.role, u.company_id, u.school_id, u.is_active, u.email_verified_at,
              COALESCE(c.claim_status, s.claim_status) AS org_claim_status
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         LEFT JOIN schools   s ON s.id = u.school_id
        WHERE u.id = $1`,
      [claims.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'account inactive or not found' });
    }

    const tenantType = tenantTypeForRole(user.role);
    const tenantId = tenantType === 'company' ? user.company_id : user.school_id;
    req.auth = {
      userId: user.id,
      role: user.role,
      tenantType,
      tenantId,
      // Operate-rights gate: a claim isn't finalized until the org is 'claimed'
      // (pending_claim = signed up but email not yet verified). §5.3.
      orgClaimStatus: user.org_claim_status,
      emailVerifiedAt: user.email_verified_at,
    };
    next();
  } catch (err) {
    next(err);
  }
};
