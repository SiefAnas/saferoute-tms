// Passwords for real users: generated temporary passwords with a forced change at first login,
// self-service "forgot password", and admin reset. See API_CONTRACT.md "Auth".
//
// Why temp password + forced change (not an invite link): email isn't configured on Render yet,
// and the admin has to hand the credential over by hand either way. A temp password shown once
// is the simplest thing that works with no email, and the forced change means the admin never
// knows the password the user actually keeps.
const crypto = require('crypto');
const pool = require('../db/pool');
const { withTx } = require('../db/tx');
const { HttpError } = require('../errors');
const { hashPassword, verifyPassword } = require('../auth/password');
const { generateToken, hashToken } = require('../auth/tokens');
const { signJwt } = require('../auth/jwt');
const { tenantTypeForRole } = require('../db/scoped');
const { sendInBackground } = require('../mail/mailer');
const { assertValidEmail, assertPasswordStrength } = require('../validate');
const { appUrl } = require('../config');

const RESET_TTL_MINUTES = 60;

// No look-alike characters (0/O, 1/l/I), so it can be read out or copied from a screen.
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

// "Kp7x-Qm4r-Tz9w": 12 random characters in 3 groups. The dashes make it pass the normal
// password rules (upper, lower, digit, special), which keeps one rule for every password.
function generateTempPassword() {
  for (;;) {
    const chars = Array.from(crypto.randomBytes(12), (b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]);
    const pw = `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw)) return pw;
  }
}

// Sessions: a token whose `iat` (seconds) is before password_changed_at is rejected by
// authenticate. The value is taken from this process's clock and truncated to the second, the
// same clock and precision jsonwebtoken uses for `iat`, so a token signed right after the
// change is valid and every token signed in an earlier second is not.
function passwordChangedNow() {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

async function setPassword(db, userId, plain, { mustChange }) {
  const hash = await hashPassword(plain);
  await db.query(
    'UPDATE users SET password_hash = $2, must_change_password = $3, password_changed_at = $4 WHERE id = $1',
    [userId, hash, mustChange, passwordChangedNow()]
  );
}

function loginPayload(user) {
  const tenantType = tenantTypeForRole(user.role);
  const tenantId = tenantType === 'company' ? user.company_id : user.school_id;
  return {
    token: signJwt({ sub: user.id, role: user.role, tt: tenantType, tid: tenantId }),
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      tenantType,
      tenantId,
      must_change_password: user.must_change_password,
    },
  };
}

// Logged-in user changes their own password (also the forced first-login change). Needs the
// current (or temporary) password. Returns a fresh token: older tokens stop working.
async function changePassword(req, { currentPassword, newPassword } = {}) {
  if (!currentPassword || !newPassword) throw new HttpError(400, 'currentPassword and newPassword are required');
  assertPasswordStrength(newPassword, 'newPassword');
  if (currentPassword === newPassword) throw new HttpError(400, 'choose a password different from the current one');
  const user = (await pool.query('SELECT * FROM users WHERE id = $1', [req.auth.userId])).rows[0];
  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    throw new HttpError(400, 'current password is incorrect');
  }
  await setPassword(pool, user.id, newPassword, { mustChange: false });
  return loginPayload({ ...user, must_change_password: false });
}

// "Forgot password". Always the same answer, whether or not the email is registered, active,
// or already has a link out: the caller learns nothing about which emails exist.
async function requestPasswordReset(email) {
  if (!email) throw new HttpError(400, 'email is required');
  assertValidEmail(email);
  const user = (await pool.query('SELECT id, email FROM users WHERE lower(email) = lower($1) AND is_active', [email])).rows[0];
  if (user) {
    const { raw, hash } = generateToken();
    await withTx(async (client) => {
      // Only the newest link works.
      await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
      await client.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '${RESET_TTL_MINUTES} minutes')`,
        [user.id, hash]
      );
    });
    // Sent after the response: waiting on SMTP would also make known emails answer slower
    // than unknown ones, which leaks which emails are registered.
    sendInBackground(
      {
        to: user.email,
        subject: 'Reset your SafeRoute password',
        text:
          `Someone asked to reset the password for this SafeRoute account.\n\n` +
          `Set a new password here (the link works once, for ${RESET_TTL_MINUTES} minutes):\n` +
          `${appUrl}/reset-password?token=${raw}\n\n` +
          `If it wasn't you, ignore this email. Your password stays the same.`,
      },
      'password_reset'
    );
  }
  return { ok: true };
}

// Completes a reset: the token must exist, be unused and not expired, and its user active.
// Marks it used, sets the new password, and signs out every existing session.
async function resetPassword({ token, newPassword } = {}) {
  if (!token || !newPassword) throw new HttpError(400, 'token and newPassword are required');
  assertPasswordStrength(newPassword, 'newPassword');
  await withTx(async (client) => {
    const row = (await client.query(
      `SELECT t.id, t.user_id FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.is_active
        FOR UPDATE OF t`,
      [hashToken(String(token))]
    )).rows[0];
    if (!row) throw new HttpError(400, 'this reset link is invalid or has expired');
    await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [row.user_id]);
    await setPassword(client, row.user_id, newPassword, { mustChange: false });
  });
  return { ok: true };
}

module.exports = { generateTempPassword, setPassword, changePassword, requestPasswordReset, resetPassword, loginPayload };
