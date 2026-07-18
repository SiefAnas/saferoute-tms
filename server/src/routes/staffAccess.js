// Staff-student access grant routes (§7.3). school_admin only — the counterpart to
// StaffStudentAccess's read side already consumed by Trips' and Students' readScope.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { grantAccess, listAccess, revokeAccess } = require('../services/staffAccess');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);
const schoolAdmin = requireRole('school_admin');

router.post('/', schoolAdmin, async (req, res, next) => {
  try { res.status(201).json(await grantAccess(req, req.body || {})); } catch (e) { next(e); }
});
router.get('/', schoolAdmin, async (req, res, next) => {
  try { res.json(await listAccess(req)); } catch (e) { next(e); }
});
router.delete('/:id', schoolAdmin, async (req, res, next) => {
  try { await revokeAccess(req, req.params.id); res.status(204).end(); } catch (e) { next(e); }
});

module.exports = router;
