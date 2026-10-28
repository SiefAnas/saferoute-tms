// Public staff info form (services/staffLinks.js). No login: the link code is the only key, and it
// travels in the request body (never the URL path). Every route is rate limited.
//   POST /staff-form/link    { code }                      what the form needs (role, company name)
//   POST /staff-form/submit  { code, ...fields }           send a form; returns the sender's edit_token
//   POST /staff-form/mine    { code, edit_token }          the sender's own form, and whether it can still change
//   PUT  /staff-form/mine    { code, edit_token, ...fields } edit it, until the admin has opened it
const express = require('express');
const { staffFormLimiter } = require('../middleware/rateLimit');
const { linkInfo, submitForm, getOwnSubmission, updateOwnSubmission } = require('../services/staffLinks');

const router = express.Router();
router.use(staffFormLimiter);

router.post('/link', async (req, res, next) => {
  try { res.json(await linkInfo(req.body || {})); } catch (e) { next(e); }
});
router.post('/submit', async (req, res, next) => {
  try { res.status(201).json(await submitForm(req.body || {})); } catch (e) { next(e); }
});
router.post('/mine', async (req, res, next) => {
  try { res.json(await getOwnSubmission(req.body || {})); } catch (e) { next(e); }
});
router.put('/mine', async (req, res, next) => {
  try { res.json(await updateOwnSubmission(req.body || {})); } catch (e) { next(e); }
});

module.exports = router;
