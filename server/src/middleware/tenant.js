// Attaches a tenant-scoped data accessor as req.db. Must run after authenticate.
const pool = require('../db/pool');
const { createScopedDb } = require('../db/scoped');

module.exports = function attachScopedDb(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'unauthenticated' });
  // Guaranteed non-null by the users_tenant_scope_check DB constraint, but guard anyway.
  if (!req.auth.tenantId) return next(new Error('authenticated user has no tenant id'));

  req.db = createScopedDb(
    pool,
    { type: req.auth.tenantType, id: req.auth.tenantId },
    { userId: req.auth.userId, role: req.auth.role }
  );
  next();
};
