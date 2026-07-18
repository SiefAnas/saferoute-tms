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

// Operate-rights gate (§5.3). A user may operate only if BOTH hold:
//   1. their org's claim is finalized ('claimed'), and
//   2. their own account is confirmed (email_verified_at is set).
// Clause 2 is essential: without it, a losing pending-claimant who stays attached to a
// placeholder that someone ELSE later claims (after a 24h-expiry takeover) would inherit
// operate-rights on that org without ever verifying their own email.
//
// BACKLOG note — email_verified_at is deliberately overloaded across three signup paths,
// each setting it for a DIFFERENT reason, but all three are treated identically by this
// gate (any of them means "operable") because that's the correct behavior in each case:
//   1. Fresh org signup  (signupFresh)   -> stamped immediately: verification WAIVED (§5.2,
//      no verification required for a brand-new self-serve org).
//   2. Claim signup      (verifyEmail)   -> stamped only after a real token round-trip:
//      email ACTUALLY PROVEN before the claim finalizes (§5.3).
//   3. Admin-created user (users.js)     -> stamped at creation time: the creating admin
//      VOUCHES for them (a company_admin/school_admin already had to prove their own
//      email via path 1 or 2, so accounts they create inherit that trust).
// Normalizing this into separate columns (e.g. a verification_method enum) was considered
// and rejected as disproportionate — there's no code path that needs to distinguish WHY a
// user is verified, only THAT they are.
// INVARIANT: every operational user must have email_verified_at set — fresh signups and
// verified claimants do; admin-created drivers/staff must stamp it at creation.
function requireOperable(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'unauthenticated' });
  if (req.auth.orgClaimStatus !== 'claimed' || !req.auth.emailVerifiedAt) {
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
