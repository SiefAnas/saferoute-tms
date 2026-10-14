// Driver sign-in reminder settings (branch signin-reminder; services/signinReminders.js).
// Company admin only: the company default and each driver's own setting.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { getSettings, setDefault, setDriver } = require('../services/signinReminders');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb, requireRole('company_admin'));

router.get('/', async (req, res, next) => {
  try { res.json(await getSettings(req)); } catch (e) { next(e); }
});
router.put('/', async (req, res, next) => {
  try { res.json(await setDefault(req, req.body || {})); } catch (e) { next(e); }
});
router.put('/drivers/:id', async (req, res, next) => {
  try { res.json(await setDriver(req, req.params.id, req.body || {})); } catch (e) { next(e); }
});

module.exports = router;
