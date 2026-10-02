// Own account (branch account-settings): every role can read and edit its own name, phone and
// address, and change its own email. Never role, is_active or tenant: those stay with the admin
// who created the account (PATCH /users/:id). Password changes are POST /auth/change-password.
//
// Email change: the new address only replaces the old one once the link sent TO the new
// address is opened (POST /auth/confirm-email-change). Until then it waits in
// users.pending_email; only the SHA-256 of the link's token is stored. Confirming signs out
// every existing session of that user, the same way a password change does.
const pool = require('../db/pool');
const { withTx } = require('../db/tx');
const { HttpError } = require('../errors');
const { verifyPassword } = require('../auth/password');
const { generateToken, hashToken } = require('../auth/tokens');
const { sendInBackground } = require('../mail/mailer');
const { assertValidEmail, assertMaxLength } = require('../validate');
const { appUrl } = require('../config');
const { publicUser } = require('./users');
const { passwordChangedNow } = require('./passwords');

const EMAIL_CHANGE_TTL_HOURS = 24;
const EDITABLE = ['full_name', 'phone', 'address'];

function ownAccount(u) {
  return {
    ...publicUser(u),
    pending_email: u.pending_email ?? null,
    pending_email_sent_at: u.pending_email ? (u.pending_email_sent_at ?? null) : null,
  };
}

async function loadSelf(db, userId) {
  const user = (await db.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
  if (!user) throw new HttpError(404, 'user not found');
  return user;
}

async function getOwnAccount(req) {
  return ownAccount(await loadSelf(pool, req.auth.userId));
}

// Same limits as the admin edit (services/users.js updateUser). Anything else in the body is
// refused rather than silently dropped, so a client can't believe it changed its role or email.
async function updateOwnAccount(req, body = {}) {
  const extra = Object.keys(body).filter((k) => !EDITABLE.includes(k));
  if (extra.length) throw new HttpError(400, `only ${EDITABLE.join(', ')} can be changed here (not ${extra.join(', ')})`);
  const patch = {};
  for (const key of EDITABLE) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && typeof body[key] !== 'string') throw new HttpError(400, `${key} must be text`);
    patch[key] = typeof body[key] === 'string' ? body[key].trim() || null : null;
  }
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'nothing to update');
  if (patch.full_name === null) throw new HttpError(400, 'full_name cannot be empty');
  assertMaxLength(patch.full_name, 200, 'full_name');
  assertMaxLength(patch.phone, 30, 'phone');
  assertMaxLength(patch.address, 300, 'address');
  // A parent account is created with a phone and an address (services/users.js createUser);
  // it can change them, not remove them.
  if (req.auth.role === 'parent') {
    if (patch.phone === null) throw new HttpError(400, 'phone is required for a parent account');
    if (patch.address === null) throw new HttpError(400, 'address is required for a parent account');
  }
  const keys = Object.keys(patch);
  const { rows } = await pool.query(
    `UPDATE users SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
    [req.auth.userId, ...keys.map((k) => patch[k])]
  );
  return ownAccount(rows[0]);
}

async function emailTaken(db, email, exceptUserId) {
  const { rows } = await db.query('SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2', [email, exceptUserId]);
  return rows.length > 0;
}

function sendEmailChangeLink(to, raw) {
  sendInBackground(
    {
      to,
      subject: 'Confirm your new SafeTurns email',
      text:
        `Someone asked to use this address for their SafeTurns account.\n\n` +
        `Confirm it here (the link works once, for ${EMAIL_CHANGE_TTL_HOURS} hours):\n` +
        `${appUrl}/confirm-email-change?token=${raw}\n\n` +
        `After you confirm, you sign in with this address and every device is signed out.\n` +
        `If it wasn't you, ignore this email. Nothing changes.`,
    },
    'email_change'
  );
}

// Stores a fresh token for the pending address (the previous link stops working) and mails it.
async function storePendingEmail(userId, email) {
  const { raw, hash } = generateToken();
  await pool.query(
    'UPDATE users SET pending_email = $2, pending_email_token_hash = $3, pending_email_sent_at = now() WHERE id = $1',
    [userId, email, hash]
  );
  sendEmailChangeLink(email, raw);
}

async function requestEmailChange(req, { newEmail, currentPassword } = {}) {
  if (!newEmail || !currentPassword) throw new HttpError(400, 'newEmail and currentPassword are required');
  const email = String(newEmail).trim();
  assertValidEmail(email, 'newEmail');
  const user = await loadSelf(pool, req.auth.userId);
  if (!(await verifyPassword(String(currentPassword), user.password_hash))) {
    throw new HttpError(400, 'current password is incorrect');
  }
  if (email.toLowerCase() === user.email.toLowerCase()) throw new HttpError(400, 'that is already your email');
  if (await emailTaken(pool, email, user.id)) throw new HttpError(409, 'email already registered');
  await storePendingEmail(user.id, email);
  return ownAccount(await loadSelf(pool, user.id));
}

// "Resend": a new link to the same pending address. No password: one was given to start it.
async function resendEmailChange(req) {
  const user = await loadSelf(pool, req.auth.userId);
  if (!user.pending_email) throw new HttpError(409, 'there is no email change waiting');
  if (await emailTaken(pool, user.pending_email, user.id)) throw new HttpError(409, 'email already registered');
  await storePendingEmail(user.id, user.pending_email);
  return ownAccount(await loadSelf(pool, user.id));
}

async function cancelEmailChange(req) {
  const { rows } = await pool.query(
    'UPDATE users SET pending_email = NULL, pending_email_token_hash = NULL, pending_email_sent_at = NULL WHERE id = $1 RETURNING *',
    [req.auth.userId]
  );
  return ownAccount(rows[0]);
}

// Public: the link from the email. Moves pending_email into email, clears the pending fields
// and signs out every session (password_changed_at is what authenticate compares tokens with).
async function confirmEmailChange({ token } = {}) {
  if (!token) throw new HttpError(400, 'token is required');
  return withTx(async (client) => {
    const user = (await client.query(
      `SELECT id, pending_email FROM users
        WHERE pending_email_token_hash = $1 AND pending_email IS NOT NULL AND is_active
          AND pending_email_sent_at > now() - interval '${EMAIL_CHANGE_TTL_HOURS} hours'
        FOR UPDATE`,
      [hashToken(String(token))]
    )).rows[0];
    if (!user) throw new HttpError(400, 'this link is invalid or has expired');
    // Someone else may have taken the address since the link was sent.
    if (await emailTaken(client, user.pending_email, user.id)) throw new HttpError(409, 'email already registered');
    try {
      await client.query(
        `UPDATE users SET email = pending_email, email_bounced = false, password_changed_at = $2,
                pending_email = NULL, pending_email_token_hash = NULL, pending_email_sent_at = NULL
          WHERE id = $1`,
        [user.id, passwordChangedNow()]
      );
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'email already registered');
      throw err;
    }
    return { ok: true, email: user.pending_email };
  });
}

module.exports = { EMAIL_CHANGE_TTL_HOURS, getOwnAccount, updateOwnAccount, requestEmailChange, resendEmailChange, cancelEmailChange, confirmEmailChange };
