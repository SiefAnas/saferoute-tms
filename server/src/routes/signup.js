// Thin routes over the signup/claim service. All unauthenticated (pre-tenant).
const express = require('express');
const { searchClaimable, signup } = require('../services/signup');
const { createClaimRequest } = require('../services/claimRequests');
const { searchLimiter, signupLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// GET /signup/:kind/claimable?name=&address=  -> candidate placeholders to claim
router.get('/:kind/claimable', searchLimiter, async (req, res, next) => {
  try {
    const candidates = await searchClaimable(req.params.kind, req.query.name || '', req.query.address || '');
    res.json({ candidates });
  } catch (err) {
    next(err);
  }
});

// POST /signup/:kind/claim-requests { claimId, fullName, email, phone?, note? } -> 202
// Asks the SafeTurns owner to hand a placeholder organization to the requester. Grants nothing.
router.post('/:kind/claim-requests', signupLimiter, async (req, res, next) => {
  try {
    res.status(202).json(await createClaimRequest(req.params.kind, req.body || {}, { ip: req.ip }));
  } catch (err) {
    next(err);
  }
});

// POST /signup/:kind  -> fresh org (immediately operational). A claimId is refused (403):
// claiming an existing placeholder goes through /claim-requests and owner approval.
router.post('/:kind', signupLimiter, async (req, res, next) => {
  try {
    const result = await signup(req.params.kind, req.body || {});
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
