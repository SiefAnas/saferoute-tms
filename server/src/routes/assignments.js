// Student <-> driver <-> van assignments (§6). company_admin manages; driver reads own.
// Tenant scoping via req.db; the Step-1 composite FKs guarantee student/driver/van all belong
// to the caller's company (a cross-company id fails the FK -> mapped to 400 here).
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole, ownerScope } = require('../middleware/authorize');
const { HttpError } = require('../errors');
const { assertValidTime } = require('../validate');
const { upsertOverride, listOverrides, deleteOverride } = require('../services/schedule');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);

const companyAdmin = requireRole('company_admin');

const mapFkError = (err) => {
  if (err.code === '23503') return new HttpError(400, 'student, driver, or van not found in your company');
  return err;
};

router.post('/', companyAdmin, async (req, res, next) => {
  try {
    const { student_id, driver_user_id, van_id, start_date, end_date, pickup_time, dropoff_time } = req.body || {};
    if (!student_id || !driver_user_id || !van_id || !start_date) {
      throw new HttpError(400, 'student_id, driver_user_id, van_id and start_date are required');
    }
    if (pickup_time !== undefined && pickup_time !== null) assertValidTime(pickup_time, 'pickup_time');
    if (dropoff_time !== undefined && dropoff_time !== null) assertValidTime(dropoff_time, 'dropoff_time');
    const row = await req.db.insert('assignments', {
      student_id, driver_user_id, van_id, start_date, end_date: end_date ?? null,
      pickup_time: pickup_time ?? null, dropoff_time: dropoff_time ?? null,
    });
    res.status(201).json(row);
  } catch (e) { next(mapFkError(e)); }
});

router.get('/', async (req, res, next) => {
  try { res.json(await req.db.findMany('assignments', { owner: ownerScope(req, 'assignments'), orderBy: 'start_date' })); }
  catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await req.db.findById('assignments', req.params.id, { owner: ownerScope(req, 'assignments') });
    if (!row) throw new HttpError(404, 'assignment not found');
    res.json(row);
  } catch (e) { next(e); }
});

router.patch('/:id', companyAdmin, async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ['start_date', 'end_date', 'driver_user_id', 'van_id', 'pickup_time', 'dropoff_time']) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    }
    if (Object.keys(patch).length === 0) throw new HttpError(400, 'nothing to update');
    if (patch.pickup_time !== null && patch.pickup_time !== undefined) assertValidTime(patch.pickup_time, 'pickup_time');
    if (patch.dropoff_time !== null && patch.dropoff_time !== undefined) assertValidTime(patch.dropoff_time, 'dropoff_time');
    const row = await req.db.update('assignments', req.params.id, patch);
    if (!row) throw new HttpError(404, 'assignment not found');
    res.json(row);
  } catch (e) { next(mapFkError(e)); }
});

router.delete('/:id', companyAdmin, async (req, res, next) => {
  try {
    const row = await req.db.remove('assignments', req.params.id);
    if (!row) throw new HttpError(404, 'assignment not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

// One-off per-date schedule exceptions (§ Driver dashboard rework) — see services/schedule.js.
router.post('/:id/overrides', companyAdmin, async (req, res, next) => {
  try {
    const { override_date, pickup_time, dropoff_time, skip, note } = req.body || {};
    if (pickup_time !== undefined && pickup_time !== null) assertValidTime(pickup_time, 'pickup_time');
    if (dropoff_time !== undefined && dropoff_time !== null) assertValidTime(dropoff_time, 'dropoff_time');
    const row = await upsertOverride(req, req.params.id, { override_date, pickup_time, dropoff_time, skip, note });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.get('/:id/overrides', companyAdmin, async (req, res, next) => {
  try { res.json(await listOverrides(req, req.params.id)); }
  catch (e) { next(e); }
});

router.delete('/:id/overrides/:overrideId', companyAdmin, async (req, res, next) => {
  try {
    await deleteOverride(req, req.params.id, req.params.overrideId);
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
