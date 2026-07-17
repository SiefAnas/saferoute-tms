// Creator-only placeholder edit (§5.3). Authenticated; the service enforces
// "you created it AND it's still unclaimed".
const express = require('express');
const authenticate = require('../middleware/authenticate');
const { editPlaceholder } = require('../services/placeholders');

const router = express.Router();

// PATCH /placeholders/:kind/:id  { name?, address? }
router.patch('/:kind/:id', authenticate, async (req, res, next) => {
  try {
    const updated = await editPlaceholder(req.auth.userId, req.params.kind, req.params.id, req.body || {});
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
