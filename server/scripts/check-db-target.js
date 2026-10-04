// Runs before every node-pg-migrate command (see the migrate scripts in package.json): refuses a
// non-local DATABASE_URL unless ALLOW_PRODUCTION_DB=yes. The rule lives in src/db/productionGuard.js.
const { assertTargetAllowed } = require('../src/db/productionGuard');

assertTargetAllowed({ purpose: 'run migrations' });
