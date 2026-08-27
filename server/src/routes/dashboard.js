// Company Admin Dashboard aggregate reads. company_admin only.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { getAbsentToday } = require('../services/dashboard');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb, requireRole('company_admin'));

router.get('/absent-today', async (req, res, next) => {
  try { res.json(await getAbsentToday(req)); } catch (e) { next(e); }
});

module.exports = router;
