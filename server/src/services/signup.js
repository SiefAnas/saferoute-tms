// Self-serve signup + claim/placeholder logic (§5.2, §5.3). Business logic lives here,
// not in the route handlers (§4). Uses the raw pool: signup has no tenant context yet,
// and claiming/placeholder rows are tenant-root records the scoped accessor won't touch.
const pool = require('../db/pool');
const { withTx } = require('../db/tx');
const { hashPassword } = require('../auth/password');
const { generateToken, hashToken } = require('../auth/tokens');
const { signJwt } = require('../auth/jwt');
const { sendInBackground } = require('../mail/mailer');
const { HttpError } = require('../errors');
const {
  assertValidEmail,
  assertPasswordStrength,
  assertValidZip,
  assertValidState,
  assertMaxLength,
} = require('../validate');

const CLAIM_TTL = "interval '24 hours'";

const KINDS = {
  company: { table: 'companies', tenantCol: 'company_id', adminRole: 'company_admin' },
  school: { table: 'schools', tenantCol: 'school_id', adminRole: 'school_admin' },
};

function kindConfig(kind) {
  const cfg = KINDS[kind];
  if (!cfg) throw new HttpError(400, `unknown kind: ${kind}`);
  return cfg;
}

// Fuzzy-match unclaimed (or expired-pending) placeholders to suggest as claim candidates.
// Reuses the Step-1 pg_trgm indexes. Returns minimal fields only.
async function searchClaimable(kind, name = '', address = '') {
  const { table } = kindConfig(kind);
  const { rows } = await pool.query(
    `SELECT id, name, address
       FROM ${table}
      WHERE claim_status IN ('unclaimed', 'pending_claim')
        AND ( ($1 <> '' AND similarity(name, $1) > 0.3)
              OR ($2 <> '' AND address ILIKE '%' || $2 || '%') )
      ORDER BY similarity(name, $1) DESC
      LIMIT 10`,
    [name, address]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    addedByPartner: true, // don't reveal which org created the placeholder
  }));
}

async function createAdminUser(client, cfg, orgId, { fullName, email, password }, emailVerified) {
  const hash = await hashPassword(password);
  try {
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, ${cfg.tenantCol}, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, ${emailVerified ? 'now()' : 'NULL'})
       RETURNING id, email, role`,
      [email, hash, fullName, cfg.adminRole, orgId]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'email already registered'); // unique_violation
    throw err;
  }
}

// Fresh signup: brand-new org, operational immediately (no email verification, §5.2).
async function signupFresh(kind, { orgName, address, zip, state, fullName, email, password }) {
  const cfg = kindConfig(kind);
  const user = await withTx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO ${cfg.table} (name, address, zip_code, state, claim_status, claimed_at)
       VALUES ($1, $2, $3, $4, 'claimed', now()) RETURNING id`,
      [orgName, address, zip, state]
    );
    return createAdminUser(client, cfg, rows[0].id, { fullName, email, password }, true);
  });
  const token = signJwt({ sub: user.id, role: user.role, tt: kind, tid: undefined });
  return { mode: 'created', token, user: { id: user.id, email: user.email, role: user.role } };
}

async function signup(kind, body = {}) {
  const { orgName, fullName, email, password, address, zip, state, claimId } = body;
  if (!fullName || !email || !password) throw new HttpError(400, 'fullName, email and password are required');
  assertValidEmail(email);
  assertPasswordStrength(password);
  assertMaxLength(fullName, 200, 'fullName');
  // Self-service claiming is off (security fix 2026-09-30): verifying your own email proved
  // nothing about working at that organization, and a claimed school sees every student other
  // companies attached to it. Claims are requests now (services/claimRequests.js).
  if (claimId) {
    const err = new HttpError(403, 'Claiming an existing organization yourself is turned off. Send a claim request instead; SafeTurns will confirm it with you.');
    err.code = 'CLAIM_REQUIRES_APPROVAL';
    throw err;
  }
  // Fresh (create-new-org) path only: address/zip/state are new required fields (the
  // "claim existing" path never collects org fields at all, so it's unaffected).
  if (!orgName) throw new HttpError(400, 'orgName is required for a new organization');
  if (!address) throw new HttpError(400, 'address is required for a new organization');
  assertMaxLength(orgName, 200, 'orgName');
  assertMaxLength(address, 500, 'address');
  assertValidZip(zip);
  const normalizedState = assertValidState(state);
  return signupFresh(kind, { orgName, address, zip, state: normalizedState, fullName, email, password });
}

// Verify email. Only marks the address verified: it never finalizes a claim any more (claims are
// approved by the SafeTurns owner, services/claimRequests.js). A verification link from a
// self-claim started before that change therefore gives no access: the organization stays
// unclaimed and requireOperable keeps refusing the account.
async function verifyEmail(rawToken) {
  if (!rawToken) throw new HttpError(400, 'token is required');
  const tokenHash = hashToken(rawToken);
  await withTx(async (client) => {
    const consumed = await client.query(
      `UPDATE email_verification_tokens
          SET consumed_at = now()
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [tokenHash]
    );
    if (consumed.rowCount === 0) throw new HttpError(400, 'invalid or expired token');
    await client.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [consumed.rows[0].user_id]);
  });
  return { verified: true, claimFinalized: false };
}

async function resendVerification(email) {
  if (!email) throw new HttpError(400, 'email is required');
  assertValidEmail(email);
  const user = (await pool.query(
    'SELECT id, email, email_verified_at, company_id, school_id FROM users WHERE lower(email) = lower($1)',
    [email]
  )).rows[0];
  // Don't reveal whether the email exists, is already verified, or has no active claim.
  if (!user || user.email_verified_at) return { ok: true };

  const [col, table] = user.company_id ? ['company_id', 'companies'] : ['school_id', 'schools'];
  const org = (await pool.query(`SELECT claim_status FROM ${table} WHERE id = $1`, [user[col]])).rows[0];
  if (!org || org.claim_status !== 'pending_claim') return { ok: true };

  const raw = await withTx(async (client) => {
    // Invalidate any still-valid prior tokens first — only the newest link should work,
    // so an old, possibly-leaked email can't be used to verify after a resend.
    await client.query(
      'UPDATE email_verification_tokens SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL',
      [user.id]
    );
    const { raw: newRaw, hash } = generateToken();
    await client.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ${CLAIM_TTL})`,
      [user.id, hash]
    );
    return newRaw;
  });

  sendInBackground({ to: user.email, subject: 'Your SafeTurns verification link', text: `token: ${raw}\nExpires in 24 hours.` }, 'resend_verification');
  return { ok: true };
}

module.exports = { searchClaimable, signup, verifyEmail, resendVerification, HttpError };
