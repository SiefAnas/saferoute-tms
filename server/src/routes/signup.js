// Thin routes over the signup/claim service. All unauthenticated (pre-tenant).
const express = require('express');
const { searchClaimable, signup } = require('../services/signup');

const router = express.Router();

// GET /signup/:kind/claimable?name=&address=  -> candidate placeholders to claim
router.get('/:kind/claimable', async (req, res, next) => {
  try {
    const candidates = await searchClaimable(req.params.kind, req.query.name || '', req.query.address || '');
    res.json({ candidates });
  } catch (err) {
    next(err);
  }
});

// POST /signup/:kind  -> fresh org (immediately operational) OR claim (pending verification)
router.post('/:kind', async (req, res, next) => {
  try {
    const result = await signup(req.params.kind, req.body || {});
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
