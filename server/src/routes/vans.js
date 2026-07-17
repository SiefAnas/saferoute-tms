// Vans (§6). company_admin manages; any operable company user may read. Tenant-scoped via req.db
// (school-side users are structurally rejected by the accessor — vans have no school scope).
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { HttpError } = require('../errors');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);
const companyAdmin = requireRole('company_admin');

router.post('/', companyAdmin, async (req, res, next) => {
  try {
    const { license_plate, model, year } = req.body || {};
    if (!license_plate) throw new HttpError(400, 'license_plate is required');
    res.status(201).json(await req.db.insert('vans', { license_plate, model: model ?? null, year: year ?? null }));
  } catch (e) { next(e); }
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
    for (const k of ['license_plate', 'model', 'year']) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    if (!Object.keys(patch).length) throw new HttpError(400, 'nothing to update');
    const row = await req.db.update('vans', req.params.id, patch);
    if (!row) throw new HttpError(404, 'van not found');
    res.json(row);
  } catch (e) { next(e); }
});

router.delete('/:id', companyAdmin, async (req, res, next) => {
  try {
    const row = await req.db.remove('vans', req.params.id);
    if (!row) throw new HttpError(404, 'van not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
