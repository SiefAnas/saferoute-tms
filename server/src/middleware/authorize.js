// Authorization: coarse role gates + role-based ownership sub-scopes (§7).
//
// Tenant isolation is handled by the scoped accessor; this adds:
//   - requireRole(...): which roles may hit a route at all
//   - ownerScope(req, table): the extra "own rows only" predicate for narrower roles
//
// Driver sees only their own shift/assignment/pay rows. (School-staff's
// "granted students only" sub-scope needs a subquery against staff_student_access
// and is applied in the student/trip routes in Step 3, not as a simple column.)

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: 'unauthenticated' });
    if (!roles.includes(req.auth.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

// Operate-rights gate (§5.3): block users whose org is still pending a claim
// (signed up against a placeholder but email not yet verified). Applied to data routes;
// NOT to /auth/me or the verification endpoints, so a pending user can still see their
// state and finish verifying. Fresh signups are born 'claimed' and pass straight through.
function requireOperable(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'unauthenticated' });
  if (req.auth.orgClaimStatus !== 'claimed') {
    return res.status(403).json({ error: 'account pending email verification' });
  }
  next();
}

// Tables where a driver is limited to rows they own, and by which column.
const DRIVER_OWNER_COLUMN = {
  sessions: 'user_id',
  assignments: 'driver_user_id',
  pay_rules: 'driver_id',
  pay_adjustments: 'driver_id',
};

// Returns { column, value } to pass as the accessor's `owner` option, or null.
function ownerScope(req, table) {
  if (req.auth.role === 'driver' && DRIVER_OWNER_COLUMN[table]) {
    return { column: DRIVER_OWNER_COLUMN[table], value: req.auth.userId };
  }
  return null;
}

module.exports = { requireRole, requireOperable, ownerScope, DRIVER_OWNER_COLUMN };
