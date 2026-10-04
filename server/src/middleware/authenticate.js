// Authentication: verify the JWT, then re-load the user from the DB so we honor
// is_active immediately and treat the DB (not the token) as the source of truth
// for role/tenant. Attaches req.auth.
//
// Two more checks (auth-accounts):
//  - a token issued before the user's last password change/reset is rejected (401), so
//    changing a password signs out old sessions;
//  - an account still on a temporary password (must_change_password) gets 403
//    PASSWORD_CHANGE_REQUIRED everywhere except the routes mounted with
//    authenticate.allowPasswordChange (GET /auth/me, POST /auth/change-password).
//  - (account-settings) users of a company that is closing get 401 ACCOUNT_CLOSING.
const pool = require('../db/pool');
const { verifyJwt } = require('../auth/jwt');
const { tenantTypeForRole } = require('../db/scoped');
const { tempPasswordExpired } = require('../services/passwords');
const { closingError } = require('../services/closure');

async function check(req, res, next, allowPasswordChange) {
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
              u.must_change_password, u.password_changed_at, u.temp_password_expires_at,
              COALESCE(c.claim_status, s.claim_status) AS org_claim_status,
              c.billing_status AS company_billing_status, c.closure_purge_at AS company_closure_purge_at
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         LEFT JOIN schools   s ON s.id = u.school_id
        WHERE u.id = $1`,
      [claims.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'account inactive or not found', code: 'ACCOUNT_INACTIVE' });
    }
    // A company that asked to close its account (services/closure.js): every one of its users
    // is refused, with the same message login gives (it says how to undo).
    if (user.company_billing_status === 'closing') {
      const err = closingError(user.company_closure_purge_at, 401);
      return res.status(401).json({ error: err.message, code: err.code });
    }
    if (user.password_changed_at && claims.iat < Math.floor(new Date(user.password_changed_at).getTime() / 1000)) {
      return res.status(401).json({ error: 'your password was changed, please log in again', code: 'PASSWORD_CHANGED' });
    }
    if (tempPasswordExpired(user)) {
      return res.status(401).json({ error: 'This temporary password has expired. Ask your admin to reset it.', code: 'TEMP_PASSWORD_EXPIRED' });
    }
    if (user.must_change_password && !allowPasswordChange) {
      return res.status(403).json({ error: 'set a new password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' });
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
      mustChangePassword: user.must_change_password,
    };
    next();
  } catch (err) {
    next(err);
  }
}

function authenticate(req, res, next) {
  return check(req, res, next, false);
}
authenticate.allowPasswordChange = (req, res, next) => check(req, res, next, true);

module.exports = authenticate;
