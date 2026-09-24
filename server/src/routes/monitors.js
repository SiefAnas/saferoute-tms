// Monitors (branch monitor-role). Two routers:
//   /monitors  company admin: list monitors with their driver and shift, assign / unassign.
//   /monitor   the monitor themself: GET /monitor/me (driver name + phone, van, days, shift).
// Accounts are created and reset through /users like drivers (role 'monitor').
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { listMonitors, setAssignment, removeAssignment, monitorHome } = require('../services/monitors');

const admin = express.Router();
admin.use(authenticate, requireOperable, attachScopedDb, requireRole('company_admin'));

admin.get('/', async (req, res, next) => {
  try { res.json(await listMonitors(req)); } catch (e) { next(e); }
});
admin.put('/:id/assignment', async (req, res, next) => {
  try { res.json(await setAssignment(req, req.params.id, req.body || {})); } catch (e) { next(e); }
});
admin.delete('/:id/assignment', async (req, res, next) => {
  try { await removeAssignment(req, req.params.id); res.status(204).end(); } catch (e) { next(e); }
});

const self = express.Router();
self.use(authenticate, requireOperable, attachScopedDb, requireRole('monitor'));

self.get('/me', async (req, res, next) => {
  try { res.json(await monitorHome(req)); } catch (e) { next(e); }
});

module.exports = { admin, self };
