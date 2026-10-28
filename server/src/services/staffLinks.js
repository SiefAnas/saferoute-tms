// Staff info by link (branch staff-info-links). Migration 039.
//
// The company admin makes a link for drivers or for monitors (3 or 7 days). Anyone with the link
// fills in a public form; each form lands in staff_submissions, never in users or vans. The admin
// reviews them on the Pending page: opening one marks it seen (from then on the sender can no
// longer edit it), Approve creates the account (and, for a driver, matches or creates the van) and
// emails a one-time "choose your password" link, Reject just closes it.
//
// Codes: the link code and the sender's edit token are random 32-byte tokens; only their SHA-256
// hashes are stored (auth/tokens.js). Every public call sends the code in the body, not the URL
// path, so it doesn't end up in request logs. A revoked or expired link is checked on every call,
// inside the same transaction as the write, so it stops working at once.
const crypto = require('crypto');
const pool = require('../db/pool');
const { withTx } = require('../db/tx');
const { HttpError } = require('../errors');
const { generateToken, hashToken } = require('../auth/tokens');
const { hashPassword } = require('../auth/password');
const { assertValidEmail, assertMaxLength, assertPasswordStrength } = require('../validate');
const { setPassword } = require('./passwords');
const { sendInBackground } = require('../mail/mailer');
const { appUrl, staffLinkMaxSubmissions } = require('../config');
const { createBuiltins } = require('./fleet');

const ROLES = ['driver', 'monitor'];
const LINK_DAYS = [3, 7];
const SETUP_TTL_HOURS = 24;
const TOKEN_RE = /^[0-9a-f]{64}$/;

function httpError(status, message, code) {
  const err = new HttpError(status, message);
  if (code) err.code = code;
  return err;
}

// "ab-12 cd" and "AB12CD" are the same plate.
const normalizePlate = (p) => String(p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const PLATE_SQL = (col) => `regexp_replace(upper(${col}), '[^A-Z0-9]', '', 'g')`;

// ---- form fields ----

function text(body, key, label, max, { required = true } = {}) {
  const v = body[key];
  if (v === undefined || v === null || String(v).trim() === '') {
    if (required) throw new HttpError(400, `${label} is required`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, `${label} must be text`);
  const s = String(v).trim();
  assertMaxLength(s, max, label);
  return s;
}

function int(body, key, label, min, max) {
  const raw = body[key];
  const n = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}`);
  return n;
}

// The fields each form takes. Anything else in the body is ignored.
function readFields(role, body = {}) {
  const email = text(body, 'email', 'email', 254);
  assertValidEmail(email);
  const fields = {
    full_name: text(body, 'full_name', 'full name', 200),
    phone: text(body, 'phone', 'phone', 30),
    email,
  };
  if (role !== 'driver') return fields;
  const plate = text(body, 'van_plate', 'van plate', 20);
  if (!normalizePlate(plate)) throw new HttpError(400, 'van plate must have letters or numbers');
  return {
    ...fields,
    van_plate: plate,
    van_make: text(body, 'van_make', 'van make', 50),
    van_model: text(body, 'van_model', 'van model', 50),
    // Free text, like the Color field on the Fleet page's van form.
    van_color: text(body, 'van_color', 'van color', 40),
    van_year: int(body, 'van_year', 'van year', 1900, 2100),
  };
}

const FORM_KEYS = ['full_name', 'phone', 'email', 'van_plate', 'van_make', 'van_model', 'van_color', 'van_year'];

function formValues(row) {
  const out = {};
  for (const k of FORM_KEYS) {
    if (row.role !== 'driver' && k.startsWith('van_')) continue;
    out[k] = row[k];
  }
  return out;
}

// ---- links ----

const linkActive = (l) => !l.revoked_at && new Date(l.expires_at) > new Date();

// The one "link doesn't work" answer: unknown, revoked and expired all read the same to the public.
const linkGone = () => httpError(410, 'This link has expired or was turned off. Ask your company for a new one.', 'LINK_INACTIVE');

async function findLink(db, code, { lock = false } = {}) {
  if (typeof code !== 'string' || !TOKEN_RE.test(code)) throw linkGone();
  const { rows } = await db.query(
    `SELECT l.*, c.name AS company_name FROM staff_links l JOIN companies c ON c.id = l.company_id
      WHERE l.code_hash = $1 ${lock ? 'FOR UPDATE OF l' : ''}`,
    [hashToken(code)]
  );
  return rows[0] ?? null;
}

async function activeLink(db, code, opts) {
  const link = await findLink(db, code, opts);
  if (!link || !linkActive(link)) throw linkGone();
  return link;
}

function publicLink(l, count) {
  return {
    id: l.id,
    role: l.role,
    code_hint: l.code_hint,
    max_submissions: l.max_submissions,
    submission_count: count ?? Number(l.submission_count ?? 0),
    expires_at: l.expires_at,
    revoked_at: l.revoked_at ?? null,
    created_at: l.created_at,
    active: linkActive(l),
  };
}

const linkUrl = (code) => `${appUrl}/staff-form?code=${code}`;

// POST /staff-links { role, expires_in_days: 3 | 7 }. The full link is in this response only.
// Counted in hours, not calendar days: '7 days' in the database's timezone is 7 days and an hour
// across a daylight saving change.
async function createLink(req, { role, expires_in_days } = {}) {
  if (!ROLES.includes(role)) throw new HttpError(400, "role must be 'driver' or 'monitor'");
  if (!LINK_DAYS.includes(expires_in_days)) throw new HttpError(400, 'expires_in_days must be 3 or 7');
  const { raw, hash } = generateToken();
  const { rows } = await pool.query(
    `INSERT INTO staff_links (company_id, role, code_hash, code_hint, max_submissions, expires_at, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6::int * 24), $7) RETURNING *`,
    [req.auth.tenantId, role, hash, raw.slice(-4), staffLinkMaxSubmissions, expires_in_days, req.auth.userId]
  );
  return { link: publicLink(rows[0], 0), url: linkUrl(raw) };
}

// GET /staff-links?role=: the links that still take forms, newest first.
async function listLinks(req, { role } = {}) {
  const { rows } = await pool.query(
    `SELECT l.*, (SELECT count(*)::int FROM staff_submissions s WHERE s.link_id = l.id) AS submission_count
       FROM staff_links l
      WHERE l.company_id = $1 AND l.revoked_at IS NULL AND l.expires_at > now() AND ($2::text IS NULL OR l.role = $2)
      ORDER BY l.created_at DESC`,
    [req.auth.tenantId, ROLES.includes(role) ? role : null]
  );
  return rows.map((l) => publicLink(l));
}

async function revokeLink(req, id) {
  const { rows } = await pool.query(
    `UPDATE staff_links SET revoked_at = COALESCE(revoked_at, now())
      WHERE id::text = $1 AND company_id = $2 RETURNING *`,
    [String(id), req.auth.tenantId]
  );
  if (!rows[0]) throw new HttpError(404, 'link not found');
  return publicLink(rows[0], 0);
}

// ---- public form ----

// POST /staff-form/link { code }: what the form needs to draw itself. No one's data.
async function linkInfo({ code } = {}) {
  const link = await activeLink(pool, code);
  return { role: link.role, company_name: link.company_name, expires_at: link.expires_at };
}

function ownView(row, link) {
  return {
    role: row.role,
    values: formValues(row),
    editable: row.status === 'new' && linkActive(link),
    submitted_at: row.created_at,
  };
}

// POST /staff-form/submit { code, ...fields }. Writes one staff_submissions row and nothing else.
// The link row is locked, so two forms sent at once can't both take the last place.
async function submitForm(body = {}) {
  return withTx(async (client) => {
    const link = await activeLink(client, body.code, { lock: true });
    const fields = readFields(link.role, body);
    const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM staff_submissions WHERE link_id = $1', [link.id]);
    if (n >= link.max_submissions) {
      throw httpError(409, 'This link has taken all the forms it can. Ask your company for a new link.', 'LINK_FULL');
    }
    const { raw, hash } = generateToken();
    const cols = Object.keys(fields);
    const { rows } = await client.query(
      `INSERT INTO staff_submissions (company_id, link_id, role, edit_token_hash, ${cols.join(', ')})
       VALUES ($1, $2, $3, $4, ${cols.map((_, i) => `$${i + 5}`).join(', ')}) RETURNING *`,
      [link.company_id, link.id, link.role, hash, ...cols.map((c) => fields[c])]
    );
    return { edit_token: raw, submission: ownView(rows[0], link) };
  });
}

// The sender's own row: the code AND the edit token they got back must both match.
async function ownRow(db, { code, edit_token } = {}, { lock = false } = {}) {
  const link = await findLink(db, code);
  if (!link) throw linkGone();
  if (typeof edit_token !== 'string' || !TOKEN_RE.test(edit_token)) throw new HttpError(404, 'form not found');
  const { rows } = await db.query(
    `SELECT * FROM staff_submissions WHERE edit_token_hash = $1 AND link_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
    [hashToken(edit_token), link.id]
  );
  if (!rows[0]) throw new HttpError(404, 'form not found');
  return { link, row: rows[0] };
}

// POST /staff-form/mine { code, edit_token }
async function getOwnSubmission(body = {}) {
  const { link, row } = await ownRow(pool, body);
  return ownView(row, link);
}

// PUT /staff-form/mine { code, edit_token, ...fields }: only while the admin hasn't opened it and
// the link still works.
async function updateOwnSubmission(body = {}) {
  return withTx(async (client) => {
    const link = await activeLink(client, body.code, { lock: true });
    const { row } = await ownRow(client, body, { lock: true });
    if (row.status !== 'new') {
      throw httpError(409, 'Your company has already opened this form, so it can no longer be changed. Contact them if something is wrong.', 'SUBMISSION_LOCKED');
    }
    const fields = readFields(link.role, body);
    const cols = Object.keys(fields);
    const { rows } = await client.query(
      `UPDATE staff_submissions SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
      [row.id, ...cols.map((c) => fields[c])]
    );
    return ownView(rows[0], link);
  });
}

// ---- admin review ----

const SUBMISSION_SQL = `
  SELECT s.*, l.code_hint,
         EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(s.email)) AS email_has_account,
         mv.id AS match_van_id, mv.license_plate AS match_van_plate, mv.number AS match_van_number
    FROM staff_submissions s
    JOIN staff_links l ON l.id = s.link_id
    LEFT JOIN LATERAL (
      SELECT v.id, v.license_plate, v.number FROM vans v
       WHERE s.role = 'driver' AND v.company_id = s.company_id AND ${PLATE_SQL('v.license_plate')} = ${PLATE_SQL('s.van_plate')}
       ORDER BY v.created_at LIMIT 1
    ) mv ON true`;

function adminView(r) {
  return {
    id: r.id,
    link_id: r.link_id,
    link_hint: r.code_hint,
    role: r.role,
    status: r.status,
    ...formValues(r),
    submitted_at: r.created_at,
    updated_at: r.updated_at,
    seen_at: r.seen_at,
    decided_at: r.decided_at,
    approved_user_id: r.approved_user_id ?? null,
    approved_van_id: r.approved_van_id ?? null,
    // Flags for the admin, worked out fresh on every read.
    email_has_account: Boolean(r.email_has_account) && r.status !== 'approved',
    van_match: r.match_van_id ? { id: r.match_van_id, license_plate: r.match_van_plate, number: r.match_van_number ?? null } : null,
  };
}

// GET /staff-submissions?role=&status=: every form, newest first. Also what "Download Excel" reads.
async function listSubmissions(req, { role, status } = {}) {
  const { rows } = await pool.query(
    `${SUBMISSION_SQL}
      WHERE s.company_id = $1 AND ($2::text IS NULL OR s.role = $2) AND ($3::text IS NULL OR s.status = $3)
      ORDER BY s.created_at DESC`,
    [req.auth.tenantId, ROLES.includes(role) ? role : null, ['new', 'seen', 'approved', 'rejected'].includes(status) ? status : null]
  );
  return rows.map(adminView);
}

async function getSubmission(db, req, id) {
  const { rows } = await db.query(`${SUBMISSION_SQL} WHERE s.id::text = $1 AND s.company_id = $2`, [String(id), req.auth.tenantId]);
  if (!rows[0]) throw new HttpError(404, 'form not found');
  return rows[0];
}

// POST /staff-submissions/:id/seen: opening a row. new -> seen (and the sender can't edit any more);
// any other status is left as it is.
async function markSeen(req, id) {
  await pool.query(
    `UPDATE staff_submissions SET status = 'seen', seen_at = now(), seen_by_user_id = $3
      WHERE id::text = $1 AND company_id = $2 AND status = 'new'`,
    [String(id), req.auth.tenantId, req.auth.userId]
  );
  return adminView(await getSubmission(pool, req, id));
}

async function lockOpen(client, req, id) {
  const { rows } = await client.query('SELECT * FROM staff_submissions WHERE id::text = $1 AND company_id = $2 FOR UPDATE', [String(id), req.auth.tenantId]);
  const row = rows[0];
  if (!row) throw new HttpError(404, 'form not found');
  if (row.status === 'approved' || row.status === 'rejected') throw httpError(409, `This form was already ${row.status}.`, 'ALREADY_DECIDED');
  return row;
}

async function rejectSubmission(req, id) {
  await withTx(async (client) => {
    await lockOpen(client, req, id);
    await client.query(
      `UPDATE staff_submissions SET status = 'rejected', decided_at = now(), decided_by_user_id = $2,
              seen_at = COALESCE(seen_at, now()), seen_by_user_id = COALESCE(seen_by_user_id, $2)
        WHERE id = $1`,
      [id, req.auth.userId]
    );
  });
  return adminView(await getSubmission(pool, req, id));
}

const emailTaken = () =>
  httpError(409, 'An account with this email already exists, so no new account was made. Check with the person, or reject this form.', 'EMAIL_HAS_ACCOUNT');

// One setup link per account: making a new one ends any older unused one.
async function issueSetupToken(db, userId) {
  const { raw, hash } = generateToken();
  await db.query('UPDATE account_setup_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  await db.query(
    `INSERT INTO account_setup_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '${SETUP_TTL_HOURS} hours')`,
    [userId, hash]
  );
  return raw;
}

function sendSetupEmail({ to, fullName, companyName, raw }) {
  sendInBackground(
    {
      to,
      subject: `Set up your SafeTurns account for ${companyName}`,
      text:
        `Hi ${fullName},\n\n${companyName} has set up a SafeTurns account for you.\n\n` +
        `Choose your password here (the link works once, for ${SETUP_TTL_HOURS} hours):\n` +
        `${appUrl}/setup-account?token=${raw}\n\n` +
        `Then sign in with this email address. If you weren't expecting this, you can ignore this email.`,
    },
    'account_setup'
  );
}

// POST /staff-submissions/:id/approve. In one transaction: the account (refused if the email
// already has one, anywhere), for a driver the van (an existing van with the same plate in this
// company is used as it is, color included; otherwise a new one is made with the form's color), and the form marked approved. The
// account gets a random password nobody knows; the person picks their own from the emailed link.
async function approveSubmission(req, id) {
  const unusable = await hashPassword(crypto.randomBytes(32).toString('hex'));
  const result = await withTx(async (client) => {
    const s = await lockOpen(client, req, id);
    const taken = await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [s.email]);
    if (taken.rows.length) throw emailTaken();

    let user;
    try {
      ({ rows: [user] } = await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, company_id, phone, email_verified_at, created_by_user_id, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7, true) RETURNING id, email, full_name, role`,
        [s.email, unusable, s.full_name, s.role, req.auth.tenantId, s.phone, req.auth.userId]
      ));
    } catch (err) {
      if (err.code === '23505') throw emailTaken();
      throw err;
    }

    let van = null;
    let vanMatched = false;
    if (s.role === 'driver') {
      const { rows: found } = await client.query(
        `SELECT id, license_plate, number FROM vans WHERE company_id = $1 AND ${PLATE_SQL('license_plate')} = $2 ORDER BY created_at LIMIT 1`,
        [req.auth.tenantId, normalizePlate(s.van_plate)]
      );
      if (found[0]) {
        van = found[0];
        vanMatched = true;
      } else {
        ({ rows: [van] } = await client.query(
          `INSERT INTO vans (company_id, license_plate, brand, model, year, color)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, license_plate, number`,
          [req.auth.tenantId, s.van_plate, s.van_make, s.van_model, s.van_year, s.van_color]
        ));
        // The same built-in maintenance items every new van gets (POST /vans), nothing due yet.
        await createBuiltins(client, req.auth.tenantId, van.id);
      }
    }

    await client.query(
      `UPDATE staff_submissions SET status = 'approved', decided_at = now(), decided_by_user_id = $2,
              seen_at = COALESCE(seen_at, now()), seen_by_user_id = COALESCE(seen_by_user_id, $2),
              approved_user_id = $3, approved_van_id = $4
        WHERE id = $1`,
      [s.id, req.auth.userId, user.id, van?.id ?? null]
    );
    const raw = await issueSetupToken(client, user.id);
    const { rows: [company] } = await client.query('SELECT name FROM companies WHERE id = $1', [req.auth.tenantId]);
    return { user, van, vanMatched, raw, companyName: company.name };
  });

  sendSetupEmail({ to: result.user.email, fullName: result.user.full_name, companyName: result.companyName, raw: result.raw });
  return {
    submission: adminView(await getSubmission(pool, req, id)),
    user: result.user,
    van: result.van,
    van_matched: result.vanMatched,
  };
}

// POST /staff-submissions/:id/resend-setup: a fresh 24-hour link (the old one stops working), for
// an approved account that hasn't chosen a password yet.
async function resendSetup(req, id) {
  const s = await getSubmission(pool, req, id);
  if (s.status !== 'approved' || !s.approved_user_id) throw new HttpError(409, 'Only an approved form has a setup email.');
  const { rows: [u] } = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.is_active, u.must_change_password, c.name AS company_name
       FROM users u JOIN companies c ON c.id = u.company_id
      WHERE u.id = $1 AND u.company_id = $2`,
    [s.approved_user_id, req.auth.tenantId]
  );
  if (!u || !u.is_active) throw new HttpError(409, 'This account is not active.');
  if (!u.must_change_password) throw httpError(409, 'This person has already set their password.', 'ALREADY_SET_UP');
  const raw = await issueSetupToken(pool, u.id);
  sendSetupEmail({ to: u.email, fullName: u.full_name, companyName: u.company_name, raw });
  return { ok: true };
}

// POST /auth/setup-account { token, newPassword }: the page the setup email opens. The token must
// exist, be unused and not expired, and its user active. Used once: it is marked used in the same
// transaction that sets the password.
async function completeAccountSetup({ token, newPassword } = {}) {
  if (!token || !newPassword) throw new HttpError(400, 'token and newPassword are required');
  assertPasswordStrength(newPassword, 'newPassword');
  await withTx(async (client) => {
    const row = (await client.query(
      `SELECT t.id, t.user_id FROM account_setup_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.is_active
        FOR UPDATE OF t`,
      [hashToken(String(token))]
    )).rows[0];
    if (!row) throw httpError(400, 'This setup link is invalid, was already used, or has expired. Ask your company to send a new one.', 'SETUP_LINK_INVALID');
    await client.query('UPDATE account_setup_tokens SET used_at = now() WHERE id = $1', [row.id]);
    await setPassword(client, row.user_id, newPassword, { mustChange: false });
  });
  return { ok: true };
}

module.exports = {
  SETUP_TTL_HOURS, normalizePlate,
  createLink, listLinks, revokeLink,
  linkInfo, submitForm, getOwnSubmission, updateOwnSubmission,
  listSubmissions, markSeen, rejectSubmission, approveSubmission, resendSetup,
  completeAccountSetup,
};
