// Parent-student link routes. company_admin only — mirrors routes/staffAccess.js.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { linkParent, listLinks, unlinkParent } = require('../services/parentAccess');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);
const companyAdmin = requireRole('company_admin');

router.post('/', companyAdmin, async (req, res, next) => {
  try { res.status(201).json(await linkParent(req, req.body || {})); } catch (e) { next(e); }
});
router.get('/', companyAdmin, async (req, res, next) => {
  try { res.json(await listLinks(req)); } catch (e) { next(e); }
});
router.delete('/:id', companyAdmin, async (req, res, next) => {
  try { await unlinkParent(req, req.params.id); res.status(204).end(); } catch (e) { next(e); }
});

module.exports = router;
