// Data deletion requests (branch account-settings). Anyone who can't close their own account can
// ask for their data to be deleted instead. That is every role: most were created by an admin and
// have no way to close their account, and a company admin can only close the whole company
// (services/closure.js), which is no exit for one person when a company has several admins.
//  - driver, monitor, parent, company_admin: the request records the company; the company's other
//    active admins are emailed (never the requester).
//  - school_admin, school_staff (migration 033): the request records the school; the school's
//    active admins are emailed.
// SafeTurns support (config.supportEmail) is emailed either way. Nothing else happens: no inbox,
// no approve / deny, no deletion. What the right reply is hasn't been decided yet.
const pool = require('../db/pool');
const config = require('../config');
const { HttpError } = require('../errors');
const { assertMaxLength } = require('../validate');
const { sendInBackground } = require('../mail/mailer');

const COMPANY_ROLES = ['driver', 'monitor', 'parent', 'company_admin'];
const SCHOOL_ROLES = ['school_admin', 'school_staff'];
const REQUEST_ROLES = [...COMPANY_ROLES, ...SCHOOL_ROLES];
const MAX_REASON = 500;
const ROLE_LABEL = { driver: 'driver', monitor: 'monitor', parent: 'parent', company_admin: 'company admin', school_admin: 'school admin', school_staff: 'school staff' };

function publicRequest(r) {
  return r ? { id: r.id, status: r.status, reason: r.reason, requested_at: r.requested_at } : null;
}

function assertCanRequest(req) {
  if (!REQUEST_ROLES.includes(req.auth.role)) {
    throw new HttpError(403, 'this role cannot request deletion');
  }
}

// The caller's open request, or null (the page shows it instead of the form).
async function getOpenRequest(req) {
  assertCanRequest(req);
  const { rows } = await pool.query("SELECT * FROM deletion_requests WHERE user_id = $1 AND status = 'open'", [req.auth.userId]);
  return { request: publicRequest(rows[0]) };
}

// The requester plus the organisation the request belongs to: the company for company-side roles,
// the school for school-side roles.
async function loadRequester(req) {
  const school = SCHOOL_ROLES.includes(req.auth.role);
  const user = (await pool.query(
    school
      ? 'SELECT u.id, u.full_name, u.email, u.role, u.school_id AS org_id, s.name AS org_name FROM users u JOIN schools s ON s.id = u.school_id WHERE u.id = $1'
      : 'SELECT u.id, u.full_name, u.email, u.role, u.company_id AS org_id, c.name AS org_name FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = $1',
    [req.auth.userId]
  )).rows[0];
  if (!user) throw new HttpError(404, 'user not found');
  return { user, school };
}

async function createRequest(req, { reason } = {}) {
  assertCanRequest(req);
  if (reason !== undefined && reason !== null && typeof reason !== 'string') throw new HttpError(400, 'reason must be text');
  const text = typeof reason === 'string' ? reason.trim() || null : null;
  assertMaxLength(text, MAX_REASON, 'reason');

  const { user, school } = await loadRequester(req);

  let row;
  try {
    row = (await pool.query(
      'INSERT INTO deletion_requests (user_id, company_id, school_id, reason) VALUES ($1, $2, $3, $4) RETURNING *',
      [user.id, school ? null : user.org_id, school ? user.org_id : null, text]
    )).rows[0];
  } catch (err) {
    // deletion_requests_one_open_per_user: one open request at a time (also under a double click).
    if (err.code === '23505') throw new HttpError(409, 'you already have an open deletion request');
    throw err;
  }

  // The organisation's other active admins: an admin asking about their own account isn't emailed
  // their own request.
  const admins = (await pool.query(
    school
      ? "SELECT email FROM users WHERE school_id = $1 AND role = 'school_admin' AND is_active AND id <> $2 ORDER BY email"
      : "SELECT email FROM users WHERE company_id = $1 AND role = 'company_admin' AND is_active AND id <> $2 ORDER BY email",
    [user.org_id, user.id]
  )).rows.map((r) => r.email);
  const orgKind = school ? 'school' : 'company';
  const message = (to) => ({
    to,
    subject: `Data deletion request: ${user.full_name} (${user.org_name})`,
    text:
      `${user.full_name} (${ROLE_LABEL[user.role]}, ${user.email}) at ${user.org_name} asked for their data ` +
      `in SafeTurns to be deleted.\n\n` +
      `Reason: ${text ?? '(none given)'}\n` +
      `Requested: ${row.requested_at.toISOString()}\n` +
      `Request id: ${row.id}\n\n` +
      `Nothing has been deleted. SafeTurns support and the ${orgKind}'s admins have both received this ` +
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
