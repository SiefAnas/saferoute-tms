// Van maintenance and fuel (branch van-maintenance; services/fleet.js).
//   Driver:        POST /fleet/fuel, GET /fleet/fuel/mine. Nothing else.
//   Company admin: everything below.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const fleet = require('../services/fleet');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);
const admin = requireRole('company_admin');
const adminOrDriver = requireRole('company_admin', 'driver');

const h = (fn, status = 200) => async (req, res, next) => {
  try {
    const out = await fn(req);
    if (out === undefined) res.status(204).end();
    else res.status(status).json(out);
  } catch (e) { next(e); }
};

router.post('/fuel', adminOrDriver, h((req) => fleet.addEntry(req, req.body || {}), 201));
router.get('/fuel/mine', requireRole('driver'), h((req) => fleet.myFuel(req)));
router.patch('/fuel/:id', admin, h((req) => fleet.updateEntry(req, req.params.id, req.body || {})));

router.get('/settings', admin, h((req) => fleet.getSettings(req)));
router.put('/settings', admin, h((req) => fleet.putSettings(req, req.body || {})));
router.get('/due', admin, h((req) => fleet.listDue(req)));
router.get('/vans/:vanId/maintenance', admin, h((req) => fleet.getVanMaintenance(req, req.params.vanId)));
router.post('/vans/:vanId/maintenance', admin, h((req) => fleet.addItem(req, req.params.vanId, req.body || {}), 201));
router.patch('/vans/:vanId/maintenance/:itemId', admin, h((req) => fleet.updateItem(req, req.params.vanId, req.params.itemId, req.body || {})));
router.delete('/vans/:vanId/maintenance/:itemId', admin, h(async (req) => { await fleet.deleteItem(req, req.params.vanId, req.params.itemId); }));
router.post('/vans/:vanId/maintenance/:itemId/done', admin, h((req) => fleet.markDone(req, req.params.vanId, req.params.itemId, req.body || {})));
router.get('/vans/:vanId/history', admin, h((req) => fleet.history(req, req.params.vanId, req.query)));
router.patch('/vans/:vanId/reminders', admin, h((req) => fleet.setVanReminders(req, req.params.vanId, req.body || {})));
router.get('/vans/:vanId/fuel', admin, h((req) => fleet.listEntries(req, req.params.vanId)));

module.exports = router;
