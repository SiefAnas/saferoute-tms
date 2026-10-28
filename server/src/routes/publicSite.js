// Public website forms (services/publicSite.js). No login; rate limited.
//   POST /public/contact       { topic: business|support, full_name, email, phone?, message }
//   POST /public/demo-request  { audience: company|school, full_name, email, phone?, organization, message? }
const express = require('express');
const { publicFormLimiter } = require('../middleware/rateLimit');
const { sendContactMessage, createDemoRequest } = require('../services/publicSite');

const router = express.Router();
router.use(publicFormLimiter);

router.post('/contact', async (req, res, next) => {
  try { res.json(await sendContactMessage(req.body || {})); } catch (e) { next(e); }
});
router.post('/demo-request', async (req, res, next) => {
  try { res.status(201).json(await createDemoRequest(req.body || {})); } catch (e) { next(e); }
});

module.exports = router;
