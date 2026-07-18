// Placeholder edit rights (§5.3): the user who CREATED a placeholder may edit its core
// info (name/address) ONLY while it is still 'unclaimed'. Once a claim is in progress
// (pending_claim) or finalized (claimed), the creator loses those rights — from then on
// the claiming owner edits it through their own tenant-scoped access.
//
// This is a deliberate cross-tenant write (a company user editing a school stub, etc.),
// so it uses the raw pool with an explicit ownership+state guard rather than req.db.
const pool = require('../db/pool');
const { HttpError } = require('../errors');
const { assertMaxLength } = require('../validate');

const KINDS = { company: 'companies', school: 'schools' };

// Who may create a placeholder of a given kind (§7.2/§7.3):
// a company admin stubs a School; a school admin stubs a Company.
const CREATOR_ROLE = { company: 'school_admin', school: 'company_admin' };

// Create an unclaimed placeholder for the OTHER tenant side. Cross-tenant root insert,
// so raw pool (not the scoped accessor). The creator is recorded for edit-rights + notify.
async function createPlaceholder(actor, kind, { name, address } = {}) {
  const table = KINDS[kind];
  if (!table) throw new HttpError(400, `unknown kind: ${kind}`);
  if (actor.role !== CREATOR_ROLE[kind]) {
    throw new HttpError(403, `only a ${CREATOR_ROLE[kind]} may create a ${kind} placeholder`);
  }
  if (!name) throw new HttpError(400, 'name is required');
  assertMaxLength(name, 200, 'name');
  assertMaxLength(address, 500, 'address');

  const { rows } = await pool.query(
    `INSERT INTO ${table} (name, address, claim_status, created_by_user_id)
     VALUES ($1, $2, 'unclaimed', $3)
     RETURNING id, name, address, claim_status, created_by_user_id`,
    [name, address ?? null, actor.userId]
  );
  return rows[0];
}

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
  assertMaxLength(patch.name, 200, 'name');
  assertMaxLength(patch.address, 500, 'address');
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

module.exports = { createPlaceholder, editPlaceholder };
