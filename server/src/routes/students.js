// Students (§6). Carry BOTH company_id (stamped from the creating company) and school_id
// (chosen — this is what links a company to a school, §4 derived relationship).
// company_admin creates/updates/deletes; any operable user reads within their tenant scope
// (a company sees its students; a school sees students at its school — same accessor, different
// tenant column), EXCEPT school_staff, who are narrowed to their granted students only (§7.4).
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole, denyRoles, driverScope } = require('../middleware/authorize');
const { HttpError, mapMissingRefError } = require('../errors');
const { assertValidZip, assertValidState } = require('../validate');
const pool = require('../db/pool');
const { listExtraAddresses, createExtraAddress, updateExtraAddress, deleteExtraAddress } = require('../services/stops');
const { isCompanySchool } = require('../services/schools');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb, denyRoles('parent', 'monitor'));
const companyAdmin = requireRole('company_admin');

const mapFk = (err) => mapMissingRefError(err, 'school_id not found');

// Optional school-issued Student ID: trimmed, blank means none, unique per company + school (any case).
function normalizeStudentId(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw new HttpError(400, 'student_id must be text');
  const v = String(value).trim();
  if (!v) return null;
  if (v.length > 50) throw new HttpError(400, 'student_id must be 50 characters or fewer');
  return v;
}

function mapStudentError(err) {
  if (err.code === '23505' && String(err.constraint || '').includes('student_id_unique')) {
    return new HttpError(409, 'another of your students at this school already has this Student ID');
  }
  return mapFk(err);
}

// school_staff -> only students granted via staff_student_access (§7.4); driver -> only
// students on their own not-ended assignments (driverScope); company_admin and school_admin
// get the full tenant scope. Same pattern as Trips' readScope.
function readScope(req) {
  if (req.auth.role === 'driver') return driverScope(req, 'student_id');
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
//
// Returns EVERY active assignment per student, not just one (shift_period split fix,
// found during the shift_period audit): a student can have a separate morning and afternoon
// assignment, each with its own driver/van, so picking "the latest one" silently hid one of
// the two shifts. `transport` is now an array, one entry per active assignment.
async function attachTransportInfo(req, students) {
  if (req.auth.tenantType !== 'school' || students.length === 0) return students;
  const { rows } = await pool.query(
    `SELECT a.student_id, a.shift_period,
            v.license_plate, v.brand, v.model, v.year, v.color, v.number AS van_number,
            u.full_name AS driver_name, u.phone AS driver_phone,
            c.name AS company_name
       FROM assignments a
       JOIN students st ON st.id = a.student_id
       JOIN vans v ON v.id = a.van_id
       JOIN users u ON u.id = a.driver_user_id
       JOIN companies c ON c.id = a.company_id
      WHERE a.student_id = ANY($1::uuid[]) AND st.school_id = $2
        -- "current" by each assignment's own company's date (a school's students can ride with
        -- companies in different timezones): this request's instant read in that company's zone.
        AND a.start_date <= ($3::timestamptz AT TIME ZONE c.timezone)::date
        AND (a.end_date IS NULL OR a.end_date >= ($3::timestamptz AT TIME ZONE c.timezone)::date)
      ORDER BY a.student_id, a.shift_period, a.created_at DESC`,
    [students.map((s) => s.id), req.auth.tenantId, req.now]
  );
  const byStudent = new Map();
  for (const r of rows) {
    if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []);
    byStudent.get(r.student_id).push({
      shift_period: r.shift_period,
      company_name: r.company_name,
      van: { number: r.van_number, license_plate: r.license_plate, brand: r.brand, model: r.model, year: r.year, color: r.color },
      driver: { full_name: r.driver_name, phone: r.driver_phone },
    });
  }
  return students.map((s) => ({ ...s, transport: byStudent.get(s.id) ?? [] }));
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
    // Only a school this company is linked to (it has students there, or created it as a new
    // school). Any other id, real or not, gets the same answer, so nothing is learned about it.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(school_id))) {
      throw new HttpError(400, 'school_id is not valid');
    }
    if (!(await isCompanySchool(req.auth.tenantId, school_id))) {
      throw new HttpError(403, "This school isn't linked to your company. Pick one of your schools, or add it as a new school first.");
    }
    assertValidZip(zip_code);
    const normalizedState = assertValidState(state);
    const studentId = normalizeStudentId(req.body?.student_id);
    const row = await req.db.insert('students', {
      full_name, grade, parent_name, parent_phone, school_id, age,
      street_address, city, state: normalizedState, zip_code,
      notes, ...(studentId ? { student_id: studentId } : {}),
    });
    res.status(201).json(row);
  } catch (e) { next(mapStudentError(e)); }
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
    // Extra addresses (e.g. "Fridays: Grandparents") are managed by the company admin; a driver
    // sees the one that applies in their schedule's `route`, not the whole list.
    const extra = req.auth.role === 'company_admin' ? { extra_addresses: await listExtraAddresses(req.auth.tenantId, row.id) } : {};
    res.json({ ...row, contacts, ...extra });
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
    if (req.body?.student_id !== undefined) patch.student_id = normalizeStudentId(req.body.student_id);
    if (!Object.keys(patch).length) throw new HttpError(400, 'nothing to update');
    const row = await req.db.update('students', req.params.id, patch);
    if (!row) throw new HttpError(404, 'student not found');
    res.json(row);
  } catch (e) { next(mapStudentError(e)); }
});

// A student with trips or schedule changes on record can't be deleted (those rows RESTRICT the
// delete; they are the pickup and custody history). Answer 409 saying what blocks it and what to
// do instead, rather than a 500 from the raw foreign-key error.
router.delete('/:id', companyAdmin, async (req, res, next) => {
  try {
    const row = await req.db.remove('students', req.params.id);
    if (!row) throw new HttpError(404, 'student not found');
    res.status(204).end();
  } catch (e) {
    if (e.code !== '23001' && e.code !== '23503') return next(e); // RESTRICT, or NO ACTION
    try {
      const { rows: [c] } = await pool.query(
        `SELECT (SELECT count(*)::int FROM trips WHERE student_id = $1 AND company_id = $2) AS trips,
                (SELECT count(*)::int FROM schedule_changes WHERE student_id = $1 AND company_id = $2) AS changes`,
        [req.params.id, req.auth.tenantId]
      );
      const held = [c.trips ? `${c.trips} trip${c.trips === 1 ? '' : 's'}` : null, c.changes ? `${c.changes} schedule change${c.changes === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ') || 'history';
      const err = new HttpError(409, `This student can't be deleted: they have ${held} on record, which is kept as pickup history. Students can't be deactivated yet; to stop transporting them, end their assignments on the Assignments page instead.`);
      err.code = 'STUDENT_HAS_HISTORY';
      next(err);
    } catch (inner) { next(inner); }
  }
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

// Extra addresses (company_admin): a different pickup / drop-off address on some weekdays.
// See services/stops.js. The student must be in the admin's company (404 otherwise).
async function assertCompanyStudent(req) {
  const student = await req.db.findById('students', req.params.id);
  if (!student) throw new HttpError(404, 'student not found');
  return student;
}

router.get('/:id/addresses', companyAdmin, async (req, res, next) => {
  try {
    await assertCompanyStudent(req);
    res.json(await listExtraAddresses(req.auth.tenantId, req.params.id));
  } catch (e) { next(e); }
});

router.post('/:id/addresses', companyAdmin, async (req, res, next) => {
  try {
    await assertCompanyStudent(req);
    res.status(201).json(await createExtraAddress(req.auth.tenantId, req.params.id, req.body || {}));
  } catch (e) { next(e); }
});

router.patch('/:id/addresses/:addressId', companyAdmin, async (req, res, next) => {
  try {
    await assertCompanyStudent(req);
    res.json(await updateExtraAddress(req.auth.tenantId, req.params.id, req.params.addressId, req.body || {}));
  } catch (e) { next(e); }
});

router.delete('/:id/addresses/:addressId', companyAdmin, async (req, res, next) => {
  try {
    await assertCompanyStudent(req);
    await deleteExtraAddress(req.auth.tenantId, req.params.id, req.params.addressId);
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
