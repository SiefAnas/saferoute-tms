// Parent <-> Student links (many-to-many). company_admin only — the counterpart to
// staff_student_access's grant/list/revoke pattern (§7.3), scoped to the company side
// instead of the school side since parent is a company-scoped role (created by
// company_admin, per the permission-changes task).
const { HttpError, mapMissingRefError } = require('../errors');

// The composite FKs (ps_parent_company_fk, ps_student_company_fk from migration 011)
// guarantee both the parent and the student belong to the SAME company as the link — the
// scoped accessor stamps that company_id, so a cross-company link is impossible to insert;
// a 23503 (or a malformed-id 22P02) here means one of the two ids just doesn't exist in this
// company at all.
async function linkParent(req, body = {}) {
  const { parent_user_id, student_id } = body;
  if (!parent_user_id || !student_id) throw new HttpError(400, 'parent_user_id and student_id are required');
  try {
    return await req.db.insert('parent_students', {
      parent_user_id,
      student_id,
      created_by_user_id: req.auth.userId,
    });
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'this parent already has access to this student');
    throw mapMissingRefError(err, 'parent or student not found in your company');
  }
}

async function listLinks(req) {
  return req.db.findMany('parent_students', { orderBy: 'created_at' });
}

async function unlinkParent(req, id) {
  const row = await req.db.remove('parent_students', id);
  if (!row) throw new HttpError(404, 'link not found');
  return row;
}

module.exports = { linkParent, listLinks, unlinkParent };
