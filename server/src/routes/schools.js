// Schools. `GET /` (BACKLOG item #7) is company_admin-only read of school names — see
// src/services/schools.js for why this is scoped to schools the caller already has
// students at, rather than a general directory. `/me` (school_admin's own profile) and
// `/:id` (a company_admin/driver reading a school their company has a student at, for the
// Driver dashboard rework) extend that same pattern rather than opening a new one.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { listCompanySchools, getCompanySchool } = require('../services/schools');
const { assertValidZip, assertValidState, assertMaxLength } = require('../validate');
const { HttpError } = require('../errors');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);

router.get('/', requireRole('company_admin'), async (req, res, next) => {
  try {
    res.json(await listCompanySchools(req.auth.tenantId));
  } catch (e) {
    next(e);
  }
});

// Registered before '/:id' so Express doesn't swallow "me" as an :id value.
// Broadened 2026-09-02 (School Hub student list task) to also let school_staff read their
// own school's contact info -- same read-broadened/write-admin-only split already used for
// dashboard.js's absent-today. PATCH below stays school_admin-only.
router.get('/me', requireRole('school_admin', 'school_staff'), async (req, res, next) => {
  try {
    const [school] = await req.db.findMany('schools', {});
    if (!school) throw new HttpError(404, 'school not found');
    res.json(school);
  } catch (e) {
    next(e);
  }
});

router.patch('/me', requireRole('school_admin'), async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ['name', 'address', 'zip_code', 'state', 'phone', 'hours', 'website']) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    }
    if (!Object.keys(patch).length) throw new HttpError(400, 'nothing to update');
    if (patch.zip_code) assertValidZip(patch.zip_code, 'zip_code');
    if (patch.state) patch.state = assertValidState(patch.state, 'state');
    assertMaxLength(patch.name, 200, 'name');
    assertMaxLength(patch.address, 500, 'address');
    assertMaxLength(patch.phone, 30, 'phone');
    assertMaxLength(patch.hours, 200, 'hours');
    assertMaxLength(patch.website, 200, 'website');
    const row = await req.db.update('schools', req.auth.tenantId, patch);
    if (!row) throw new HttpError(404, 'school not found');
    res.json(row);
  } catch (e) {
    next(e);
  }
});

router.get('/:id', requireRole('company_admin', 'driver'), async (req, res, next) => {
  try {
    const school = await getCompanySchool(req.auth.tenantId, req.params.id);
    if (!school) throw new HttpError(404, 'school not found');
    res.json(school);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
