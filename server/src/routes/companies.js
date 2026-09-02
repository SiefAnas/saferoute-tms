// Company Admin's own org profile. Mirrors schools.js's GET/PATCH /me exactly — companies
// had no self-service profile edit surface at all before this (school_admin already had one).
// Added so companies.phone (new column, § pickup-confirmation task) is actually settable, not
// a field that's permanently blank on the parent dashboard's "More info" panel.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { assertValidZip, assertValidState, assertMaxLength } = require('../validate');
const { HttpError } = require('../errors');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb, requireRole('company_admin'));

router.get('/me', async (req, res, next) => {
  try {
    const [company] = await req.db.findMany('companies', {});
    if (!company) throw new HttpError(404, 'company not found');
    res.json(company);
  } catch (e) {
    next(e);
  }
});

router.patch('/me', async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ['name', 'address', 'zip_code', 'state', 'phone']) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    }
    if (!Object.keys(patch).length) throw new HttpError(400, 'nothing to update');
    if (patch.zip_code) assertValidZip(patch.zip_code, 'zip_code');
    if (patch.state) patch.state = assertValidState(patch.state, 'state');
    assertMaxLength(patch.name, 200, 'name');
    assertMaxLength(patch.address, 500, 'address');
    assertMaxLength(patch.phone, 30, 'phone');
    const row = await req.db.update('companies', req.auth.tenantId, patch);
    if (!row) throw new HttpError(404, 'company not found');
    res.json(row);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
