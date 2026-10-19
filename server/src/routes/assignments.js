// Student <-> driver <-> van assignments (§6). company_admin manages; driver reads own.
// Tenant scoping via req.db; the Step-1 composite FKs guarantee student/driver/van all belong
// to the caller's company (a cross-company id fails the FK -> mapped to 400 here).
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole, ownerScope, denyRoles, driverScope } = require('../middleware/authorize');
const { HttpError, mapMissingRefError } = require('../errors');
const { assertValidTime } = require('../validate');
const { upsertOverride, listOverrides, deleteOverride } = require('../services/schedule');
const { normalizeSchedule, assertAssignable } = require('../services/assignmentRules');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb, denyRoles('parent', 'monitor'));

const companyAdmin = requireRole('company_admin');

const mapFkError = (err) => mapMissingRefError(err, 'student, driver, or van not found in your company');

router.post('/', companyAdmin, async (req, res, next) => {
  try {
    const { student_id, driver_user_id, van_id, start_date, end_date } = req.body || {};
    if (!student_id || !driver_user_id || !van_id || !start_date) {
      throw new HttpError(400, 'student_id, driver_user_id, van_id and start_date are required');
    }
    // Same rules as the assignments import (services/assignmentRules.js).
    const candidate = { student_id, driver_user_id, van_id, start_date, end_date: end_date ?? null, ...normalizeSchedule(req.body) };
    await assertAssignable(req.db, candidate);
    const row = await req.db.insert('assignments', candidate);
    res.status(201).json(row);
  } catch (e) { next(mapFkError(e)); }
});

// Driver: own assignments that have not ended (driverScope); an ended one reads as 404.
router.get('/', async (req, res, next) => {
  try { res.json(await req.db.findMany('assignments', { ...driverScope(req, 'id'), orderBy: 'start_date' })); }
  catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await req.db.findById('assignments', req.params.id, driverScope(req, 'id') ?? {});
    if (!row) throw new HttpError(404, 'assignment not found');
    res.json(row);
  } catch (e) { next(e); }
});

router.patch('/:id', companyAdmin, async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ['start_date', 'end_date', 'driver_user_id', 'van_id', 'pickup_time', 'dropoff_time', 'shift_period', 'days_of_week']) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    }
    if (Object.keys(patch).length === 0) throw new HttpError(400, 'nothing to update');
    Object.assign(patch, normalizeSchedule(patch, { partial: true }));
    const existing = await req.db.findById('assignments', req.params.id, { owner: ownerScope(req, 'assignments') });
    if (!existing) throw new HttpError(404, 'assignment not found');
    if (
      patch.driver_user_id !== undefined || patch.van_id !== undefined ||
      patch.start_date !== undefined || patch.end_date !== undefined || patch.shift_period !== undefined ||
      patch.days_of_week !== undefined
    ) {
      await assertAssignable(req.db, {
        student_id: existing.student_id,
        driver_user_id: patch.driver_user_id ?? existing.driver_user_id,
        van_id: patch.van_id ?? existing.van_id,
        start_date: patch.start_date ?? existing.start_date,
        end_date: patch.end_date !== undefined ? patch.end_date : existing.end_date,
        shift_period: patch.shift_period ?? existing.shift_period,
        days_of_week: patch.days_of_week ?? existing.days_of_week,
      }, { checkDriver: patch.driver_user_id !== undefined, excludeId: req.params.id });
    }
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
