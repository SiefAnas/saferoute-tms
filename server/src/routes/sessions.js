// Driver shift routes. Tenant-scoped; drivers act on their own shifts, admins read all.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable } = require('../middleware/authorize');
const { checkIn, checkOut, listSessions, getSession } = require('../services/sessions');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);

router.post('/checkin', async (req, res, next) => {
  try { res.status(201).json(await checkIn(req, req.body || {})); } catch (e) { next(e); }
});
router.post('/:id/checkout', async (req, res, next) => {
  try { res.json(await checkOut(req, req.params.id, req.body || {})); } catch (e) { next(e); }
});
router.get('/', async (req, res, next) => {
  try { res.json(await listSessions(req)); } catch (e) { next(e); }
});
router.get('/:id', async (req, res, next) => {
  try { res.json(await getSession(req, req.params.id)); } catch (e) { next(e); }
});

module.exports = router;
