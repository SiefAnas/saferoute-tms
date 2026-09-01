// Staff <-> Student access grants (§7.3, §7.4). A School Admin grants/revokes which
// School Staff member can see which students. Static assignment, no date range (§6) —
// simpler than the driver/van Assignments pattern by design.
const { HttpError, mapMissingRefError } = require('../errors');

// The composite FKs (ssa_staff_school_fk, ssa_student_school_fk from migration 006)
// guarantee both the staff member and the student belong to the SAME school as the
// grant — the scoped accessor stamps that school_id, so a cross-school grant is
// impossible to insert; a 23503 (or a malformed-id 22P02) here means one of the two ids
// just doesn't exist at all.
async function grantAccess(req, body = {}) {
  const { staff_user_id, student_id } = body;
  if (!staff_user_id || !student_id) throw new HttpError(400, 'staff_user_id and student_id are required');
  try {
    return await req.db.insert('staff_student_access', {
      staff_user_id,
      student_id,
      granted_by_user_id: req.auth.userId,
    });
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'this staff member already has access to this student');
    throw mapMissingRefError(err, 'staff member or student not found in your school');
  }
}

async function listAccess(req) {
  return req.db.findMany('staff_student_access', { orderBy: 'created_at' });
}

async function revokeAccess(req, id) {
  const row = await req.db.remove('staff_student_access', id);
  if (!row) throw new HttpError(404, 'grant not found');
  return row;
}

module.exports = { grantAccess, listAccess, revokeAccess };
