// Schools (BACKLOG item #7). company_admin-only read of school names — see
// src/services/schools.js for why this is scoped to schools the caller already has
// students at, rather than a general directory.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { listCompanySchools } = require('../services/schools');

const router = express.Router();
router.use(authenticate, requireOperable, requireRole('company_admin'));

router.get('/', async (req, res, next) => {
  try {
    res.json(await listCompanySchools(req.auth.tenantId));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
