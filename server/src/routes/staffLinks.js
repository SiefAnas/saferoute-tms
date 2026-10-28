// Staff info links, company admin side (services/staffLinks.js). Two routers:
//   /staff-links        make a driver or monitor link, list the active ones, revoke one
//   /staff-submissions  the Pending page: list, mark seen, approve, reject, resend the setup email
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { verifyLimiter } = require('../middleware/rateLimit');
const {
  createLink, listLinks, revokeLink, listSubmissions, markSeen, rejectSubmission, approveSubmission, resendSetup,
} = require('../services/staffLinks');

const guard = [authenticate, requireOperable, attachScopedDb, requireRole('company_admin')];

const links = express.Router();
links.use(...guard);

links.get('/', async (req, res, next) => {
  try { res.json(await listLinks(req, req.query)); } catch (e) { next(e); }
});
links.post('/', async (req, res, next) => {
  try { res.status(201).json(await createLink(req, req.body || {})); } catch (e) { next(e); }
});
links.post('/:id/revoke', async (req, res, next) => {
  try { res.json(await revokeLink(req, req.params.id)); } catch (e) { next(e); }
});

const submissions = express.Router();
submissions.use(...guard);

submissions.get('/', async (req, res, next) => {
  try { res.json(await listSubmissions(req, req.query)); } catch (e) { next(e); }
});
submissions.post('/:id/seen', async (req, res, next) => {
  try { res.json(await markSeen(req, req.params.id)); } catch (e) { next(e); }
});
submissions.post('/:id/reject', async (req, res, next) => {
  try { res.json(await rejectSubmission(req, req.params.id)); } catch (e) { next(e); }
});
// Approve sends one email per form, so it isn't limited (an admin may approve a whole link's worth
// in one sitting). Resend can be clicked over and over, so it shares the verify-email limiter.
submissions.post('/:id/approve', async (req, res, next) => {
  try { res.json(await approveSubmission(req, req.params.id)); } catch (e) { next(e); }
});
submissions.post('/:id/resend-setup', verifyLimiter, async (req, res, next) => {
  try { res.json(await resendSetup(req, req.params.id)); } catch (e) { next(e); }
});

module.exports = { links, submissions };
