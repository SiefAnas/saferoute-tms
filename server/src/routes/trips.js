// Trip routes. Tenant-scoped via req.db; driver logs, school_staff confirms, all read
// through role sub-scopes (driver=own shifts, staff=granted students, admins=full tenant).
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable } = require('../middleware/authorize');
const { logTrip, confirmTrip, listTrips, getTrip } = require('../services/trips');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);

router.post('/', async (req, res, next) => {
  try { res.status(201).json(await logTrip(req, req.body || {})); } catch (e) { next(e); }
});
router.post('/:id/confirm', async (req, res, next) => {
  try { res.json(await confirmTrip(req, req.params.id)); } catch (e) { next(e); }
});
router.get('/', async (req, res, next) => {
  try { res.json(await listTrips(req)); } catch (e) { next(e); }
});
router.get('/:id', async (req, res, next) => {
  try { res.json(await getTrip(req, req.params.id)); } catch (e) { next(e); }
});

module.exports = router;
