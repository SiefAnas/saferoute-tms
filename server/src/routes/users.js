// User management routes. All tenant-scoped via req.db; only admins may manage users.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { createUser, listUsers, getUser, updateUser, adminResetPassword } = require('../services/users');
const { getOwnAccount, updateOwnAccount, requestEmailChange, resendEmailChange, cancelEmailChange } = require('../services/account');
const { verifyLimiter } = require('../middleware/rateLimit');
const { getOpenRequest, createRequest } = require('../services/deletionRequests');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);

const adminsOnly = requireRole('company_admin', 'school_admin');

// Own account, every role (services/account.js). Declared before /:id so "me" isn't read as an id.
router.get('/me', async (req, res, next) => {
  try { res.json(await getOwnAccount(req)); } catch (e) { next(e); }
});
router.patch('/me', async (req, res, next) => {
  try { res.json(await updateOwnAccount(req, req.body || {})); } catch (e) { next(e); }
});
// Each of these sends an email, so they share the verify-email limiter.
router.post('/me/email-change', verifyLimiter, async (req, res, next) => {
  try { res.json(await requestEmailChange(req, req.body || {})); } catch (e) { next(e); }
});
router.post('/me/email-change/resend', verifyLimiter, async (req, res, next) => {
  try { res.json(await resendEmailChange(req)); } catch (e) { next(e); }
});
router.delete('/me/email-change', async (req, res, next) => {
  try { res.json(await cancelEmailChange(req)); } catch (e) { next(e); }
});
// Data deletion request (driver, monitor, parent; services/deletionRequests.js). Sends email, so
// it shares the verify limiter too.
router.get('/me/deletion-request', async (req, res, next) => {
  try { res.json(await getOpenRequest(req)); } catch (e) { next(e); }
});
router.post('/me/deletion-request', verifyLimiter, async (req, res, next) => {
  try { res.status(201).json(await createRequest(req, req.body || {})); } catch (e) { next(e); }
});

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

// Give the user a new temporary password (shown once). See services/users.js adminResetPassword.
router.post('/:id/reset-password', adminsOnly, async (req, res, next) => {
  try { res.json(await adminResetPassword(req, req.params.id)); } catch (e) { next(e); }
});

module.exports = router;
