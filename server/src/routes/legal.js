// Terms of Use / Privacy Policy (services/legal.js).
//  - GET /legal/:document is public: the login and register pages link to it.
//  - POST /legal/accept is the signed-in "I agree" (first sign-in, or a new version). It stays
//    open while acceptance is pending (authenticate.allowPasswordChange lets it through).
const express = require('express');
const pool = require('../db/pool');
const authenticate = require('../middleware/authenticate');
const { getLegalDocument, acceptCurrentLegal } = require('../services/legal');

const router = express.Router();

// POST /legal/accept { terms: '<version>', privacy: '<version>' } -> { ok, legal_pending: false, versions }
// The password change comes first: an account still on a temporary password is refused here too.
router.post('/accept', authenticate.allowPasswordChange, async (req, res, next) => {
  try {
    if (req.auth.mustChangePassword) {
      return res.status(403).json({ error: 'set a new password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    res.json(await acceptCurrentLegal(pool, req.auth.userId, req.body || {}, req.ip));
  } catch (e) {
    next(e);
  }
});

// GET /legal/terms | /legal/privacy -> { document, version, effective, markdown }
router.get('/:document', (req, res, next) => {
  try {
    res.json(getLegalDocument(req.params.document));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
