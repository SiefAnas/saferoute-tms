// Public Terms of Use / Privacy Policy (services/legal.js). No auth: the login and register
// pages link to them.
const express = require('express');
const { getLegalDocument } = require('../services/legal');

const router = express.Router();

// GET /legal/terms | /legal/privacy -> { document, version, effective, markdown }
router.get('/:document', (req, res, next) => {
  try {
    res.json(getLegalDocument(req.params.document));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
