// Parent role's own routes: which students they're linked to, and the real (not mockup)
// Skip Today's Pickup action. parent role only.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { listMyStudents, getSkipStatus, skipPickup, getStudentDetail } = require('../services/parentPortal');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb, requireRole('parent'));

router.get('/students', async (req, res, next) => {
  try { res.json(await listMyStudents(req)); } catch (e) { next(e); }
});
router.get('/students/:id/detail', async (req, res, next) => {
  try { res.json(await getStudentDetail(req, req.params.id)); } catch (e) { next(e); }
});
router.get('/students/:id/skip-status', async (req, res, next) => {
  try { res.json(await getSkipStatus(req, req.params.id)); } catch (e) { next(e); }
});
router.post('/students/:id/skip-pickup', async (req, res, next) => {
  try { res.json(await skipPickup(req, req.params.id)); } catch (e) { next(e); }
});

module.exports = router;
