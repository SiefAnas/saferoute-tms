// Dashboard aggregate reads. /absent-today started company_admin-only; extended 2026-09-02
// (§ pickup-confirmation task) to school_admin/school_staff too, since it's "just displaying
// existing data" they should also be able to see for their own school.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { getAbsentToday } = require('../services/dashboard');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb, requireRole('company_admin', 'school_admin', 'school_staff'));

router.get('/absent-today', async (req, res, next) => {
  try { res.json(await getAbsentToday(req)); } catch (e) { next(e); }
});

module.exports = router;
