// "Left early" / "staying later" schedule-change log. school_staff and school_admin only —
// see services/scheduleChanges.js for the notification + left-early-skip side effects.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { listScheduleChangesToday, logScheduleChange } = require('../services/scheduleChanges');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb, requireRole('school_staff', 'school_admin'));

router.get('/', async (req, res, next) => {
  try { res.json(await listScheduleChangesToday(req)); } catch (e) { next(e); }
});

router.post('/students/:id', async (req, res, next) => {
  try { res.status(201).json(await logScheduleChange(req, req.params.id, req.body || {})); } catch (e) { next(e); }
});

module.exports = router;
