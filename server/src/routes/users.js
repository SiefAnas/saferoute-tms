// User management routes. All tenant-scoped via req.db; only admins may manage users.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { createUser, listUsers, getUser, updateUser } = require('../services/users');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);

const adminsOnly = requireRole('company_admin', 'school_admin');

router.post('/', adminsOnly, async (req, res, next) => {
  try { res.status(201).json(await createUser(req, req.body || {})); } catch (e) { next(e); }
});
router.get('/', adminsOnly, async (req, res, next) => {
  try { res.json(await listUsers(req, { role: req.query.role })); } catch (e) { next(e); }
});
router.get('/:id', adminsOnly, async (req, res, next) => {
  try { res.json(await getUser(req, req.params.id)); } catch (e) { next(e); }
});
router.patch('/:id', adminsOnly, async (req, res, next) => {
  try { res.json(await updateUser(req, req.params.id, req.body || {})); } catch (e) { next(e); }
});

module.exports = router;
