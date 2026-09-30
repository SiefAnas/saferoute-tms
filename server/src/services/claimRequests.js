// Claiming a placeholder organization (a school or company another org added before it joined
// SafeTurns) is a REQUEST, approved by the SafeTurns owner. Self-service claiming is off: proving
// you own an email address says nothing about working at that school, and a claimed school
// sees every student other companies attached to it.
//
//   createClaimRequest  public (POST /signup/:kind/claim-requests): records who asked, for which
//                       placeholder, when. Creates no account and changes no organization.
//   approveClaimRequest owner only (server/scripts/claim-requests.js): creates the admin account
//                       with a temporary password, marks the organization claimed, closes the
//                       placeholder's other requests and deactivates any stray accounts attached
//                       to it (e.g. a half-finished self-claim from before this change).
//   rejectClaimRequest  owner only.
const pool = require('../db/pool');
const { withTx } = require('../db/tx');
const { HttpError } = require('../errors');
const { hashPassword } = require('../auth/password');
const { assertValidEmail, assertMaxLength } = require('../validate');
const { TEMP_PASSWORD_DAYS, generateTempPassword } = require('./passwords');

const KINDS = {
  company: { table: 'companies', tenantCol: 'company_id', adminRole: 'company_admin' },
  school: { table: 'schools', tenantCol: 'school_id', adminRole: 'school_admin' },
};
const CLAIMABLE = "claim_status IN ('unclaimed', 'pending_claim')";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function kindConfig(kind) {
  const cfg = KINDS[kind];
  if (!cfg) throw new HttpError(400, `unknown kind: ${kind}`);
  return cfg;
}

async function createClaimRequest(kind, body = {}, { ip = null } = {}) {
  const cfg = kindConfig(kind);
  const { claimId, fullName, email, phone, note } = body;
  if (!claimId || !fullName || !email) throw new HttpError(400, 'claimId, fullName and email are required');
  if (!UUID.test(String(claimId))) throw new HttpError(400, 'claimId is not valid');
  assertValidEmail(email);
  assertMaxLength(fullName, 200, 'fullName');
  assertMaxLength(phone, 30, 'phone');
  assertMaxLength(note, 1000, 'note');

  const org = (await pool.query(`SELECT id FROM ${cfg.table} WHERE id = $1 AND ${CLAIMABLE}`, [claimId])).rows[0];
  if (!org) throw new HttpError(409, 'this organization is not available to claim');
  try {
    await pool.query(
      `INSERT INTO placeholder_claim_requests (org_kind, org_id, requester_name, requester_email, requester_phone, note, requester_ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [kind, claimId, fullName, email, phone || null, note || null, ip]
    );
  } catch (err) {
    // Already asked and still waiting: same answer, no second row.
    if (err.code !== '23505') throw err;
  }
  return {
    status: 'pending',
    message: 'Request received. SafeTurns will confirm it with you before any account is created. Nothing is shared until then.',
  };
}

async function listClaimRequests({ status = 'pending' } = {}) {
  const { rows } = await pool.query(
    `SELECT r.id, r.org_kind, r.org_id, COALESCE(c.name, s.name) AS org_name, COALESCE(c.address, s.address) AS org_address,
            r.requester_name, r.requester_email, r.requester_phone, r.note, r.requester_ip, r.status, r.created_at,
            r.decided_at, r.decided_by
       FROM placeholder_claim_requests r
       LEFT JOIN companies c ON r.org_kind = 'company' AND c.id = r.org_id
       LEFT JOIN schools s ON r.org_kind = 'school' AND s.id = r.org_id
      WHERE ($1::text IS NULL OR r.status = $1)
      ORDER BY r.created_at`,
    [status]
  );
  return rows;
}

async function approveClaimRequest(requestId, { decidedBy, note = null } = {}) {
  if (!decidedBy) throw new HttpError(400, 'decidedBy is required (who approved it)');
  return withTx(async (client) => {
    const request = (await client.query('SELECT * FROM placeholder_claim_requests WHERE id = $1 FOR UPDATE', [requestId])).rows[0];
    if (!request) throw new HttpError(404, 'claim request not found');
    if (request.status !== 'pending') throw new HttpError(409, `claim request is already ${request.status}`);
    const cfg = kindConfig(request.org_kind);
    const org = (await client.query(`SELECT id, name FROM ${cfg.table} WHERE id = $1 AND ${CLAIMABLE} FOR UPDATE`, [request.org_id])).rows[0];
    if (!org) throw new HttpError(409, 'the organization is no longer available to claim');
    const taken = (await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [request.requester_email])).rows[0];
    if (taken) throw new HttpError(409, 'that email already has a SafeTurns account; ask the requester for another email');

    const temporaryPassword = generateTempPassword();
    const hash = await hashPassword(temporaryPassword);
    // Owner-vouched, like admin-created accounts: email_verified_at is set; the requester must
    // choose their own password at first sign-in.
    const user = (await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, ${cfg.tenantCol}, phone, email_verified_at,
                          must_change_password, temp_password_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now(), true, now() + interval '${TEMP_PASSWORD_DAYS} days')
       RETURNING id, email, full_name, role`,
      [request.requester_email, hash, request.requester_name, cfg.adminRole, org.id, request.requester_phone]
    )).rows[0];
    // Anyone else attached to the placeholder never passed approval (a half-finished self-claim).
    await client.query(`UPDATE users SET is_active = false WHERE ${cfg.tenantCol} = $1 AND id <> $2 AND is_active`, [org.id, user.id]);
    await client.query(
      `UPDATE ${cfg.table} SET claim_status = 'claimed', claimed_at = now(), claim_expires_at = NULL, claimed_by_user_id = $2 WHERE id = $1`,
      [org.id, user.id]
    );
    await client.query(
      `UPDATE placeholder_claim_requests SET status = 'approved', decided_at = now(), decided_by = $2, decision_note = $3, created_user_id = $4
        WHERE id = $1`,
      [request.id, decidedBy, note, user.id]
    );
    await client.query(
      `UPDATE placeholder_claim_requests SET status = 'rejected', decided_at = now(), decided_by = $3, decision_note = 'another request for this organization was approved'
        WHERE org_kind = $1 AND org_id = $2 AND status = 'pending'`,
      [request.org_kind, org.id, decidedBy]
    );
    return { org, user, temporaryPassword };
  });
}

async function rejectClaimRequest(requestId, { decidedBy, note = null } = {}) {
  if (!decidedBy) throw new HttpError(400, 'decidedBy is required (who rejected it)');
  const { rows } = await pool.query(
    `UPDATE placeholder_claim_requests SET status = 'rejected', decided_at = now(), decided_by = $2, decision_note = $3
      WHERE id = $1 AND status = 'pending' RETURNING id`,
    [requestId, decidedBy, note]
  );
  if (!rows[0]) throw new HttpError(409, 'claim request not found or already decided');
  return { id: rows[0].id, status: 'rejected' };
}

module.exports = { createClaimRequest, listClaimRequests, approveClaimRequest, rejectClaimRequest };
