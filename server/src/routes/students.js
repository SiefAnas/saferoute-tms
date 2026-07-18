// Students (§6). Carry BOTH company_id (stamped from the creating company) and school_id
// (chosen — this is what links a company to a school, §4 derived relationship).
// company_admin creates/updates/deletes; any operable user reads within their tenant scope
// (a company sees its students; a school sees students at its school — same accessor, different
// tenant column), EXCEPT school_staff, who are narrowed to their granted students only (§7.4).
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { HttpError } = require('../errors');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);
const companyAdmin = requireRole('company_admin');

const mapFk = (err) => (err.code === '23503' ? new HttpError(400, 'school_id not found') : err);

// school_staff -> only students granted via staff_student_access (§7.4); everyone else
// (company_admin, school_admin) gets the full tenant scope. Same pattern as Trips' readScope.
function readScope(req) {
  if (req.auth.role === 'school_staff') {
    return { ownerIn: { column: 'id', table: 'staff_student_access', refColumn: 'student_id', match: { staff_user_id: req.auth.userId } } };
  }
  return {};
}

router.post('/', companyAdmin, async (req, res, next) => {
  try {
    const { full_name, grade, parent_name, parent_phone, school_id } = req.body || {};
    if (!full_name || !school_id) throw new HttpError(400, 'full_name and school_id are required');
    const row = await req.db.insert('students', {
      full_name, grade: grade ?? null, parent_name: parent_name ?? null, parent_phone: parent_phone ?? null, school_id,
    });
    res.status(201).json(row);
  } catch (e) { next(mapFk(e)); }
});

router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.grade) where.grade = req.query.grade;
    res.json(await req.db.findMany('students', { ...readScope(req), where, orderBy: 'full_name' }));
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await req.db.findById('students', req.params.id, readScope(req));
    if (!row) throw new HttpError(404, 'student not found');
    res.json(row);
  } catch (e) { next(e); }
});

router.patch('/:id', companyAdmin, async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ['full_name', 'grade', 'parent_name', 'parent_phone']) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    if (!Object.keys(patch).length) throw new HttpError(400, 'nothing to update');
    const row = await req.db.update('students', req.params.id, patch);
    if (!row) throw new HttpError(404, 'student not found');
    res.json(row);
  } catch (e) { next(e); }
});

router.delete('/:id', companyAdmin, async (req, res, next) => {
  try {
    const row = await req.db.remove('students', req.params.id);
    if (!row) throw new HttpError(404, 'student not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
