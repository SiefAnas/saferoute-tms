// Data deletion requests (branch account-settings). Drivers, monitors and parents were created by
// their company admin, so they can't close their own account; they can ask for their data to be
// deleted. A request is a record (deletion_requests) plus an email to SafeTurns support
// (config.supportEmail) and to the company's active admins. Nothing else happens: no inbox, no
// approve / deny, no deletion. What the right reply is hasn't been decided yet.
const pool = require('../db/pool');
const config = require('../config');
const { HttpError } = require('../errors');
const { assertMaxLength } = require('../validate');
const { sendInBackground } = require('../mail/mailer');

const REQUEST_ROLES = ['driver', 'monitor', 'parent'];
const MAX_REASON = 500;
const ROLE_LABEL = { driver: 'driver', monitor: 'monitor', parent: 'parent' };

function publicRequest(r) {
  return r ? { id: r.id, status: r.status, reason: r.reason, requested_at: r.requested_at } : null;
}

function assertCanRequest(req) {
  if (!REQUEST_ROLES.includes(req.auth.role)) {
    throw new HttpError(403, 'only drivers, monitors and parents can request deletion here; admins close the whole account');
  }
}

// The caller's open request, or null (the page shows it instead of the form).
async function getOpenRequest(req) {
  assertCanRequest(req);
  const { rows } = await pool.query("SELECT * FROM deletion_requests WHERE user_id = $1 AND status = 'open'", [req.auth.userId]);
  return { request: publicRequest(rows[0]) };
}

async function createRequest(req, { reason } = {}) {
  assertCanRequest(req);
  if (reason !== undefined && reason !== null && typeof reason !== 'string') throw new HttpError(400, 'reason must be text');
  const text = typeof reason === 'string' ? reason.trim() || null : null;
  assertMaxLength(text, MAX_REASON, 'reason');

  const user = (await pool.query(
    'SELECT u.id, u.full_name, u.email, u.role, u.company_id, c.name AS company_name FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = $1',
    [req.auth.userId]
  )).rows[0];
  if (!user) throw new HttpError(404, 'user not found');

  let row;
  try {
    row = (await pool.query(
      'INSERT INTO deletion_requests (user_id, company_id, reason) VALUES ($1, $2, $3) RETURNING *',
      [user.id, user.company_id, text]
    )).rows[0];
  } catch (err) {
    // deletion_requests_one_open_per_user: one open request at a time (also under a double click).
    if (err.code === '23505') throw new HttpError(409, 'you already have an open deletion request');
    throw err;
  }

  const admins = (await pool.query(
    "SELECT email FROM users WHERE company_id = $1 AND role = 'company_admin' AND is_active ORDER BY email",
    [user.company_id]
  )).rows.map((r) => r.email);
  const message = (to) => ({
    to,
    subject: `Data deletion request: ${user.full_name} (${user.company_name})`,
    text:
      `${user.full_name} (${ROLE_LABEL[user.role]}, ${user.email}) at ${user.company_name} asked for their data ` +
      `in SafeTurns to be deleted.\n\n` +
      `Reason: ${text ?? '(none given)'}\n` +
      `Requested: ${row.requested_at.toISOString()}\n` +
      `Request id: ${row.id}\n\n` +
      `Nothing has been deleted. SafeTurns support and the company's admins have both received this ` +
      `email; reply to the person directly.`,
  });
  if (config.supportEmail) {
    sendInBackground(message(config.supportEmail), 'deletion_request_support');
  } else {
    console.error(`[deletion-request] SUPPORT_EMAIL is not set: SafeTurns support was NOT emailed about request ${row.id}`);
  }
  for (const to of admins) sendInBackground(message(to), 'deletion_request_admin');

  return { request: publicRequest(row) };
}

module.exports = { REQUEST_ROLES, MAX_REASON, getOpenRequest, createRequest };
