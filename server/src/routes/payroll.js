// Payroll routes (§7.2). company_admin manages rules/adjustments and reads summaries;
// a driver may read their own rule/adjustments/summary.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { HttpError } = require('../errors');
const { upsertRule, listRules, addAdjustment, summary, unpaidSummary, markPaid, listAdjustments } = require('../services/payroll');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb);

const companyAdmin = requireRole('company_admin');
// A driver may only touch their own driver id.
function assertSelfOrAdmin(req, driverId) {
  if (req.auth.role === 'company_admin') return;
  if (req.auth.role === 'driver' && req.auth.userId === driverId) return;
  throw new HttpError(403, 'forbidden');
}

router.put('/rules/:driverId', companyAdmin, async (req, res, next) => {
  try { res.json(await upsertRule(req, req.params.driverId, req.body || {})); } catch (e) { next(e); }
});
router.get('/rules', companyAdmin, async (req, res, next) => {
  try { res.json(await listRules(req)); } catch (e) { next(e); }
});
router.post('/adjustments', companyAdmin, async (req, res, next) => {
  try { res.status(201).json(await addAdjustment(req, req.body || {})); } catch (e) { next(e); }
});
router.get('/summary/:driverId', async (req, res, next) => {
  try {
    assertSelfOrAdmin(req, req.params.driverId);
    res.json(await summary(req, req.params.driverId, { from: req.query.from, to: req.query.to }));
  } catch (e) { next(e); }
});

// The Payroll page's "Paid" feature: current unpaid cycle + settling it.
router.get('/unpaid-summary/:driverId', companyAdmin, async (req, res, next) => {
  try { res.json(await unpaidSummary(req, req.params.driverId)); } catch (e) { next(e); }
});
router.post('/rules/:driverId/mark-paid', companyAdmin, async (req, res, next) => {
  try { res.json(await markPaid(req, req.params.driverId)); } catch (e) { next(e); }
});
router.get('/adjustments/:driverId', async (req, res, next) => {
  try {
    assertSelfOrAdmin(req, req.params.driverId);
    res.json(await listAdjustments(req, req.params.driverId));
  } catch (e) { next(e); }
});

module.exports = router;
