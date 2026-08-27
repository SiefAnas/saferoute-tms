// Vans (§6). company_admin manages; any operable company user may read. Tenant-scoped via req.db
// (school-side users are structurally rejected by the accessor — vans have no school scope).
//
// Fleet page task (2026-08-27): brand/model split, color required on creation. license_plate/
// year were already/now also required. color stays nullable at the DB level (existing vans
// predate it), enforced here instead — same precedent as company/school zip+state.
//
// Rework (2026-08-27, later): vans no longer carry their own "assigned driver" field at all.
// That standalone tag could silently disagree with the real assignments table (also
// student+driver+van) — removed entirely per Anas's direction once flagged. "Driver" for a
// van is now purely a read-side concept, derived client-side from today's active
// assignment(s) using that van (see VansPage.tsx) — there's no write path for it here,
// since "assign a driver to a van" would need to name a student too, which doesn't make
// sense as a van-level action (a van isn't tied to one student).
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { HttpError } = require('../errors');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);
const companyAdmin = requireRole('company_admin');

function assertValidYear(year) {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new HttpError(400, 'year must be a whole number between 1900 and 2100');
  }
}

router.post('/', companyAdmin, async (req, res, next) => {
  try {
    const { license_plate, brand, model, year, color } = req.body || {};
    if (!license_plate || !brand || !model || !year || !color) {
      throw new HttpError(400, 'license_plate, brand, model, year and color are all required');
    }
    assertValidYear(year);
    const row = await req.db.insert('vans', { license_plate, brand, model, year, color });
    res.status(201).json(row);
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
    for (const k of ['license_plate', 'brand', 'model', 'year', 'color']) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    }
    if (!Object.keys(patch).length) throw new HttpError(400, 'nothing to update');
    if (patch.year !== undefined) assertValidYear(patch.year);
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
