// A driver's own daily schedule (§ Driver dashboard rework) — active assignments for
// today, enriched with student/school summaries and any one-off override for today.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { getTodaySchedule, getWeekSchedule, markNoShow } = require('../services/schedule');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb, requireRole('driver'));

router.get('/today', async (req, res, next) => {
  try { res.json(await getTodaySchedule(req)); }
  catch (e) { next(e); }
});

// V2: the driver's 7-day schedule from ?start=YYYY-MM-DD (see services/schedule.js).
router.get('/week', async (req, res, next) => {
  try { res.json(await getWeekSchedule(req, req.query.start)); }
  catch (e) { next(e); }
});

router.post('/:assignmentId/no-show', async (req, res, next) => {
  try { res.json(await markNoShow(req, req.params.assignmentId, req.body || {})); }
  catch (e) { next(e); }
});

module.exports = router;
