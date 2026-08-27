// Vans (§6). company_admin manages; any operable company user may read. Tenant-scoped via req.db
// (school-side users are structurally rejected by the accessor — vans have no school scope).
//
// Fleet page task (2026-08-27): brand/model split, color, and an assigned driver are all
// required on creation. license_plate/year were already/now also required. color and
// driver_user_id stay nullable at the DB level (existing vans have neither), enforced here
// instead — same precedent as company/school zip+state.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { HttpError } = require('../errors');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);
const companyAdmin = requireRole('company_admin');

const mapFkError = (err) => (err.code === '23503' ? new HttpError(400, 'driver not found in your company') : err);

function assertValidYear(year) {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new HttpError(400, 'year must be a whole number between 1900 and 2100');
  }
}

router.post('/', companyAdmin, async (req, res, next) => {
  try {
    const { license_plate, brand, model, year, color, driver_user_id } = req.body || {};
    if (!license_plate || !brand || !model || !year || !color || !driver_user_id) {
      throw new HttpError(400, 'license_plate, brand, model, year, color and driver_user_id are all required');
    }
    assertValidYear(year);
    const row = await req.db.insert('vans', { license_plate, brand, model, year, color, driver_user_id });
    res.status(201).json(row);
  } catch (e) { next(mapFkError(e)); }
});

router.get('/', async (req, res, next) => {
  try { res.json(await req.db.findMany('vans', { orderBy: 'license_plate' })); } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await req.db.findById('vans', req.params.id);
    if (!row) throw new HttpError(404, 'van not found');
    res.json(row);
  } catch (e) { next(e); }
});

router.patch('/:id', companyAdmin, async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ['license_plate', 'brand', 'model', 'year', 'color', 'driver_user_id']) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    }
    if (!Object.keys(patch).length) throw new HttpError(400, 'nothing to update');
    if (patch.year !== undefined) assertValidYear(patch.year);
    const row = await req.db.update('vans', req.params.id, patch);
    if (!row) throw new HttpError(404, 'van not found');
    res.json(row);
  } catch (e) { next(mapFkError(e)); }
});

router.delete('/:id', companyAdmin, async (req, res, next) => {
  try {
    const row = await req.db.remove('vans', req.params.id);
    if (!row) throw new HttpError(404, 'van not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
