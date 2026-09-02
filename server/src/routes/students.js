// Students (§6). Carry BOTH company_id (stamped from the creating company) and school_id
// (chosen — this is what links a company to a school, §4 derived relationship).
// company_admin creates/updates/deletes; any operable user reads within their tenant scope
// (a company sees its students; a school sees students at its school — same accessor, different
// tenant column), EXCEPT school_staff, who are narrowed to their granted students only (§7.4).
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { HttpError, mapMissingRefError } = require('../errors');
const { assertValidZip, assertValidState } = require('../validate');
const pool = require('../db/pool');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);
const companyAdmin = requireRole('company_admin');

const mapFk = (err) => mapMissingRefError(err, 'school_id not found');

// school_staff -> only students granted via staff_student_access (§7.4); everyone else
// (company_admin, school_admin) gets the full tenant scope. Same pattern as Trips' readScope.
function readScope(req) {
  if (req.auth.role === 'school_staff') {
    return { ownerIn: { column: 'id', table: 'staff_student_access', refColumn: 'student_id', match: { staff_user_id: req.auth.userId } } };
  }
  return {};
}

// School Hub student list task (2026-09-02): school_staff/school_admin's own tenant is the
// school, not the company, so their req.db can't reach assignments/vans/users/companies
// directly (all company-tenant-only tables) to show which company/van/driver is actually
// assigned to each student. Raw pool, batched for the whole list rather than N+1. Manually
// ANDs st.school_id so this can never surface another school's assignment even though the
// student ids passed in already came from the caller's own tenant-scoped read above — same
// belt-and-suspenders precedent as scheduleChanges.js's applyPickupSkip. Skipped entirely
// for company_admin readers (their own company's data, already visible elsewhere, and
// req.auth.tenantId is a company id there so the school_id filter wouldn't even apply).
async function attachTransportInfo(req, students) {
  if (req.auth.tenantType !== 'school' || students.length === 0) return students;
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (a.student_id) a.student_id,
            v.license_plate, v.brand, v.model, v.year, v.color,
            u.full_name AS driver_name, u.phone AS driver_phone,
            c.name AS company_name
       FROM assignments a
       JOIN students st ON st.id = a.student_id
       JOIN vans v ON v.id = a.van_id
       JOIN users u ON u.id = a.driver_user_id
       JOIN companies c ON c.id = a.company_id
      WHERE a.student_id = ANY($1::uuid[]) AND st.school_id = $2
        AND a.start_date <= CURRENT_DATE AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
      ORDER BY a.student_id, a.created_at DESC`,
    [students.map((s) => s.id), req.auth.tenantId]
  );
  const byStudent = new Map(rows.map((r) => [r.student_id, r]));
  return students.map((s) => {
    const t = byStudent.get(s.id);
    return {
      ...s,
      company_name: t?.company_name ?? null,
      van: t ? { license_plate: t.license_plate, brand: t.brand, model: t.model, year: t.year, color: t.color } : null,
      driver: t ? { full_name: t.driver_name, phone: t.driver_phone } : null,
    };
  });
}

// Students page task (2026-08-27): every field required except notes. Enforced here (not a
// DB NOT NULL) since existing students have real NULLs in several of these — same precedent
// as the van fleet fields alongside this change.
//
// §7 item 6 (2026-09-01): notes is no longer the one exception — every field is required now,
// including notes (the frontend hints "'None' if there's nothing to flag" so this doesn't
// force a real note where there isn't one).
//
// Rework (2026-08-27, later): students no longer carry their own "assigned driver" field.
// That standalone tag could silently disagree with the real assignments table — removed per
// Anas's direction once flagged. "Which driver" for a student is now purely a read-side
// concept, derived client-side from today's active assignment for that student
// (StudentsPage.tsx). Creating/changing that link goes through the real POST/PATCH
// /assignments endpoints (already company_admin-gated + tenant-scoped), which the frontend
// calls itself right after creating/editing the student — not through this route.
router.post('/', companyAdmin, async (req, res, next) => {
  try {
    const { full_name, grade, parent_name, parent_phone, school_id, age, street_address, city, state, zip_code, notes } =
      req.body || {};
    if (!full_name || !grade || !parent_name || !parent_phone || !school_id || age === undefined || age === null) {
      throw new HttpError(
        400,
        'full_name, grade, age, parent_name, parent_phone and school_id are required'
      );
    }
    if (!street_address || !city || !state || !zip_code) {
      throw new HttpError(400, 'street_address, city, state and zip_code are required');
    }
    if (!notes) throw new HttpError(400, 'notes is required');
    assertValidZip(zip_code);
    const normalizedState = assertValidState(state);
    const row = await req.db.insert('students', {
      full_name, grade, parent_name, parent_phone, school_id, age,
      street_address, city, state: normalizedState, zip_code,
      notes,
    });
    res.status(201).json(row);
  } catch (e) { next(mapFk(e)); }
});

router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.grade) where.grade = req.query.grade;
    const rows = await req.db.findMany('students', { ...readScope(req), where, orderBy: 'full_name' });
    res.json(await attachTransportInfo(req, rows));
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await req.db.findById('students', req.params.id, readScope(req));
    if (!row) throw new HttpError(404, 'student not found');
    const contacts = await req.db.findMany('student_contacts', { where: { student_id: row.id }, orderBy: 'name' });
    res.json({ ...row, contacts });
  } catch (e) { next(e); }
});

router.patch('/:id', companyAdmin, async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ['full_name', 'grade', 'parent_name', 'parent_phone', 'age', 'street_address', 'city', 'zip_code', 'notes']) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    }
    if (req.body?.zip_code !== undefined && req.body.zip_code !== null) assertValidZip(req.body.zip_code);
    if (req.body?.state !== undefined && req.body.state !== null) patch.state = assertValidState(req.body.state);
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

// Additional contacts beyond the student's primary parent_name/parent_phone (§ Driver
// dashboard rework). student_contacts is dual-tenant (company_id + school_id) but the
// caller here is company-tenant only, so req.db.insert only auto-stamps company_id —
// school_id is looked up from the student itself and passed through explicitly.
router.post('/:id/contacts', companyAdmin, async (req, res, next) => {
  try {
    const { name, phone, relationship } = req.body || {};
    if (!name) throw new HttpError(400, 'name is required');
    const student = await req.db.findById('students', req.params.id);
    if (!student) throw new HttpError(404, 'student not found');
    const row = await req.db.insert('student_contacts', {
      student_id: student.id, school_id: student.school_id,
      name, phone: phone ?? null, relationship: relationship ?? null,
    });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.delete('/:id/contacts/:contactId', companyAdmin, async (req, res, next) => {
  try {
    const row = await req.db.remove('student_contacts', req.params.contactId, {
      owner: { column: 'student_id', value: req.params.id },
    });
    if (!row) throw new HttpError(404, 'contact not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
