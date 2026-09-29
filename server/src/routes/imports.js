// Bulk import (docs/bulk-import-spec.md). Admins only; every import is scoped to the importer's
// own company or school. Web only: nothing in the mobile app calls these.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const attachScopedDb = require('../middleware/tenant');
const { requireOperable, requireRole } = require('../middleware/authorize');
const { typesFor, preview, commit, getMapping, saveMapping, MAX_ROWS } = require('../services/bulkImport');

const router = express.Router();
router.use(authenticate, requireOperable, attachScopedDb, requireRole('company_admin', 'school_admin'));
// The commit response carries temporary passwords: never cache it.
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/types', (req, res) => res.json({ max_rows: MAX_ROWS, types: typesFor(req.auth.role) }));

router.get('/mapping', async (req, res, next) => {
  try { res.json(await getMapping(req, req.query.type)); } catch (e) { next(e); }
});
router.put('/mapping', async (req, res, next) => {
  try { res.json(await saveMapping(req, req.body?.type, req.body?.mapping)); } catch (e) { next(e); }
});

router.post('/preview', async (req, res, next) => {
  try { res.json(await preview(req, req.body?.type, req.body?.rows)); } catch (e) { next(e); }
});
router.post('/commit', async (req, res, next) => {
  try { res.json(await commit(req, req.body?.type, req.body?.rows)); } catch (e) { next(e); }
});

module.exports = router;
