// Placeholder edit rights (§5.3): the user who CREATED a placeholder may edit its core
// info (name/address) ONLY while it is still 'unclaimed'. Once a claim is in progress
// (pending_claim) or finalized (claimed), the creator loses those rights — from then on
// the claiming owner edits it through their own tenant-scoped access.
//
// This is a deliberate cross-tenant write (a company user editing a school stub, etc.),
// so it uses the raw pool with an explicit ownership+state guard rather than req.db.
const pool = require('../db/pool');
const { HttpError } = require('./signup');

const KINDS = { company: 'companies', school: 'schools' };

async function editPlaceholder(actorUserId, kind, id, patch = {}) {
  const table = KINDS[kind];
  if (!table) throw new HttpError(400, `unknown kind: ${kind}`);

  const org = (await pool.query(
    `SELECT id, created_by_user_id, claim_status FROM ${table} WHERE id = $1`,
    [id]
  )).rows[0];
  if (!org) throw new HttpError(404, 'placeholder not found');

  if (org.created_by_user_id !== actorUserId) {
    throw new HttpError(403, 'only the creator may edit this placeholder');
  }
  if (org.claim_status !== 'unclaimed') {
    throw new HttpError(403, 'placeholder has been claimed; edit rights revoked');
  }

  // Only name/address are editable core info.
  const fields = [];
  const values = [];
  for (const key of ['name', 'address']) {
    if (patch[key] !== undefined) {
      values.push(patch[key]);
      fields.push(`${key} = $${values.length}`);
    }
  }
  if (fields.length === 0) throw new HttpError(400, 'nothing to update (name/address only)');

  values.push(id);
  const updated = (await pool.query(
    `UPDATE ${table} SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING id, name, address, claim_status`,
    values
  )).rows[0];
  return updated;
}

module.exports = { editPlaceholder };
