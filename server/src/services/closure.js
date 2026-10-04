// Company account closure, REQUEST SIDE ONLY (branch account-settings). Nothing is deleted here
// and there is no purge job: what the purge would have to do is written down in
// docs/ACCOUNT_SETTINGS_QUESTIONS.md, to be designed with the retention rules.
//
// Request (company_admin, password + the company name typed exactly): the company goes to
// billing_status 'closing' with closure_purge_at 30 days out, every session of every user of
// the company is signed out, and the admin gets an email with an undo link. While closing,
// login and every authenticated request refuse the company's users (ACCOUNT_CLOSING).
// Undo (the link, no sign-in possible meanwhile): clears the closure while the purge date is in
// the future.
const pool = require('../db/pool');
const { withTx } = require('../db/tx');
const { HttpError } = require('../errors');
const { verifyPassword } = require('../auth/password');
const { generateToken, hashToken } = require('../auth/tokens');
const { sendInBackground } = require('../mail/mailer');
const { appUrl } = require('../config');
const { passwordChangedNow } = require('./passwords');

const CLOSURE_DAYS = 30;
// billing_status after an undo. Only the free pilot exists; see the questions file.
const STATUS_AFTER_UNDO = 'free';

function formatDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// The message every user of a closing company sees at login (and as the 401 on any request).
function closingMessage(purgeAt) {
  return (
    `This company's SafeTurns account is being closed. Everyone has been signed out, and its data ` +
    `will be deleted on ${formatDay(purgeAt)}. To keep the account, the company admin who closed it ` +
    `can open the undo link in the closure email before then. If you need help, contact your company.`
  );
}

function closingError(purgeAt, status) {
  const err = new HttpError(status, closingMessage(purgeAt));
  err.code = 'ACCOUNT_CLOSING';
  return err;
}

async function requestClosure(req, { currentPassword, confirmName } = {}) {
  if (!currentPassword || typeof confirmName !== 'string') throw new HttpError(400, 'currentPassword and confirmName are required');
  const user = (await pool.query('SELECT id, email, password_hash FROM users WHERE id = $1', [req.auth.userId])).rows[0];
  if (!user || !(await verifyPassword(String(currentPassword), user.password_hash))) {
    throw new HttpError(400, 'current password is incorrect');
  }
  const { raw, hash } = generateToken();
  const company = await withTx(async (client) => {
    const c = (await client.query('SELECT id, name, billing_status FROM companies WHERE id = $1 FOR UPDATE', [req.auth.tenantId])).rows[0];
    if (!c) throw new HttpError(404, 'company not found');
    // Exactly as stored: no trimming, no case folding. The point is to make the admin read it.
    if (confirmName !== c.name) throw new HttpError(400, 'the company name you typed does not match');
    if (c.billing_status === 'closing') throw new HttpError(409, 'this company is already closing');
    const updated = (await client.query(
      `UPDATE companies SET billing_status = 'closing', closure_requested_at = now(),
              closure_purge_at = now() + interval '${CLOSURE_DAYS} days', closure_requested_by = $2,
              closure_undo_token_hash = $3
        WHERE id = $1
        RETURNING name, closure_requested_at, closure_purge_at`,
      [c.id, user.id, hash]
    )).rows[0];
    // "Everyone is signed out now": every token issued before this second stops working, also
    // after an undo (people sign in again then).
    await client.query('UPDATE users SET password_changed_at = $2 WHERE company_id = $1', [c.id, passwordChangedNow()]);
    return updated;
  });
  sendInBackground(
    {
      to: user.email,
      subject: `${company.name}: SafeTurns account closing`,
      text:
        `You asked to close the SafeTurns account of ${company.name}.\n\n` +
        `Everyone in the company has been signed out and can't sign in. All of the company's data ` +
        `will be deleted on ${formatDay(company.closure_purge_at)}.\n\n` +
        `Changed your mind? Undo it before then with this link:\n` +
        `${appUrl}/company-closure/undo?token=${raw}\n\n` +
        `Keep this email: it is the only way to undo the closure.`,
    },
    'company_closure'
  );
  return { closure_requested_at: company.closure_requested_at, closure_purge_at: company.closure_purge_at };
}

// Public (nobody in the company can sign in while it's closing): the token is the proof.
async function undoClosure(token) {
  if (!token) throw new HttpError(400, 'token is required');
  const row = (await pool.query(
    `UPDATE companies SET billing_status = $2, closure_requested_at = NULL, closure_purge_at = NULL,
            closure_requested_by = NULL, closure_undo_token_hash = NULL
      WHERE closure_undo_token_hash = $1 AND billing_status = 'closing' AND closure_purge_at > now()
      RETURNING name`,
    [hashToken(String(token)), STATUS_AFTER_UNDO]
  )).rows[0];
  if (!row) throw new HttpError(400, 'this undo link is invalid or has expired');
  return { ok: true, company: row.name };
}

module.exports = { CLOSURE_DAYS, closingMessage, closingError, requestClosure, undoClosure };
