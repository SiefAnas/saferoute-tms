// Self-serve signup + claim/placeholder logic (§5.2, §5.3). Business logic lives here,
// not in the route handlers (§4). Uses the raw pool: signup has no tenant context yet,
// and claiming/placeholder rows are tenant-root records the scoped accessor won't touch.
const pool = require('../db/pool');
const { hashPassword } = require('../auth/password');
const { generateToken, hashToken } = require('../auth/tokens');
const { signJwt } = require('../auth/jwt');
const { sendMail } = require('../mail/mailer');

const CLAIM_TTL = "interval '24 hours'";

const KINDS = {
  company: { table: 'companies', tenantCol: 'company_id', adminRole: 'company_admin' },
  school: { table: 'schools', tenantCol: 'school_id', adminRole: 'school_admin' },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function kindConfig(kind) {
  const cfg = KINDS[kind];
  if (!cfg) throw new HttpError(400, `unknown kind: ${kind}`);
  return cfg;
}

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Fuzzy-match unclaimed (or expired-pending) placeholders to suggest as claim candidates.
// Reuses the Step-1 pg_trgm indexes. Returns minimal fields only.
async function searchClaimable(kind, name = '', address = '') {
  const { table } = kindConfig(kind);
  const { rows } = await pool.query(
    `SELECT id, name, address
       FROM ${table}
      WHERE (claim_status = 'unclaimed'
             OR (claim_status = 'pending_claim' AND claim_expires_at < now()))
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
async function signupFresh(kind, { orgName, address, fullName, email, password }) {
  const cfg = kindConfig(kind);
  const user = await withTx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO ${cfg.table} (name, address, claim_status, claimed_at)
       VALUES ($1, $2, 'claimed', now()) RETURNING id`,
      [orgName, address ?? null]
    );
    return createAdminUser(client, cfg, rows[0].id, { fullName, email, password }, true);
  });
  const token = signJwt({ sub: user.id, role: user.role, tt: kind, tid: undefined });
  return { mode: 'created', token, user: { id: user.id, email: user.email, role: user.role } };
}

// Claim signup: lock an existing placeholder, create an UNVERIFIED admin, email a token.
// Not operational until POST /auth/verify-email finalizes the claim.
async function signupClaim(kind, claimId, { fullName, email, password }) {
  const cfg = kindConfig(kind);
  const result = await withTx(async (client) => {
    // Atomic lock: only if still unclaimed, or a previous pending claim has expired.
    const locked = await client.query(
      `UPDATE ${cfg.table}
          SET claim_status = 'pending_claim',
              claim_expires_at = now() + ${CLAIM_TTL},
              claimed_by_user_id = NULL
        WHERE id = $1
          AND (claim_status = 'unclaimed'
               OR (claim_status = 'pending_claim' AND claim_expires_at < now()))
        RETURNING id, name`,
      [claimId]
    );
    if (locked.rowCount === 0) {
      throw new HttpError(409, 'this record is not available to claim (already claimed or a claim is in progress)');
    }
    const user = await createAdminUser(client, cfg, claimId, { fullName, email, password }, false);
    await client.query(`UPDATE ${cfg.table} SET claimed_by_user_id = $1 WHERE id = $2`, [user.id, claimId]);

    const { raw, hash } = generateToken();
    await client.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + ${CLAIM_TTL})`,
      [user.id, hash]
    );
    return { user, raw, orgName: locked.rows[0].name };
  });

  await sendMail({
    to: email,
    subject: 'Verify your email to finish claiming ' + result.orgName,
    text:
      `You're claiming "${result.orgName}" on SafeRoute.\n` +
      `Verify your email to activate the account:\n` +
      `  token: ${result.raw}\n` +
      `This link expires in 24 hours.`,
  });

  return { mode: 'pending_claim', userId: result.user.id, email: result.user.email };
}

async function signup(kind, body = {}) {
  const { orgName, fullName, email, password, address, claimId } = body;
  if (!fullName || !email || !password) throw new HttpError(400, 'fullName, email and password are required');
  if (claimId) return signupClaim(kind, claimId, { fullName, email, password });
  if (!orgName) throw new HttpError(400, 'orgName is required for a new organization');
  return signupFresh(kind, { orgName, address, fullName, email, password });
}

// Verify email; if the user has a pending claim, finalize it and notify the placeholder creator.
async function verifyEmail(rawToken) {
  if (!rawToken) throw new HttpError(400, 'token is required');
  const tokenHash = hashToken(rawToken);

  const finalized = await withTx(async (client) => {
    const consumed = await client.query(
      `UPDATE email_verification_tokens
          SET consumed_at = now()
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [tokenHash]
    );
    if (consumed.rowCount === 0) throw new HttpError(400, 'invalid or expired token');
    const userId = consumed.rows[0].user_id;

    const u = (await client.query('UPDATE users SET email_verified_at = now() WHERE id = $1 RETURNING company_id, school_id', [userId])).rows[0];

    // Finalize the pending claim in whichever org this user belongs to.
    let claimedOrg = null;
    for (const [col, table] of [['company_id', 'companies'], ['school_id', 'schools']]) {
      if (!u[col]) continue;
      const done = await client.query(
        `UPDATE ${table}
            SET claim_status = 'claimed', claimed_at = now(), claim_expires_at = NULL
          WHERE id = $1 AND claim_status = 'pending_claim' AND claimed_by_user_id = $2
          RETURNING id, name, created_by_user_id`,
        [u[col], userId]
      );
      if (done.rowCount > 0) claimedOrg = done.rows[0];
    }
    return claimedOrg;
  });

  // Notify the original placeholder creator (outside the tx).
  if (finalized && finalized.created_by_user_id) {
    const creator = (await pool.query('SELECT email FROM users WHERE id = $1', [finalized.created_by_user_id])).rows[0];
    if (creator) {
      await sendMail({
        to: creator.email,
        subject: `A placeholder you created was claimed: ${finalized.name}`,
        text: `The organization "${finalized.name}" you added on SafeRoute has been claimed by its owner. You no longer have edit rights on its core details.`,
      });
    }
  }

  return { verified: true, claimFinalized: Boolean(finalized) };
}

async function resendVerification(email) {
  if (!email) throw new HttpError(400, 'email is required');
  const user = (await pool.query(
    'SELECT id, email, email_verified_at FROM users WHERE lower(email) = lower($1)',
    [email]
  )).rows[0];
  // Don't reveal whether the email exists / is already verified.
  if (!user || user.email_verified_at) return { ok: true };

  const { raw, hash } = generateToken();
  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ${CLAIM_TTL})`,
    [user.id, hash]
  );
  await sendMail({ to: user.email, subject: 'Your SafeRoute verification link', text: `token: ${raw}\nExpires in 24 hours.` });
  return { ok: true };
}

module.exports = { searchClaimable, signup, verifyEmail, resendVerification, HttpError };
