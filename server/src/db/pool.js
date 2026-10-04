// Single shared pg connection pool.
const { Pool } = require('pg');
const { databaseUrl } = require('../config');
const { assertTargetAllowed } = require('./productionGuard');

// Every script and the API reach the database through this pool, so the production check here
// covers them all (including scripts written later): a non-local DATABASE_URL needs
// ALLOW_PRODUCTION_DB=yes, otherwise the process exits before connecting.
assertTargetAllowed({ purpose: 'connect' });

const pool = new Pool({ connectionString: databaseUrl });

// node-postgres emits 'error' on the pool when an idle client hits a network-level
// problem (e.g. a transient DNS blip or dropped connection to Neon). Without a listener
// here, that's an unhandled EventEmitter 'error' event, which crashes the whole process
// per Node's default behavior — turning a transient blip into a full API outage instead
// of a single failed query. Log and let the pool recover (it replaces the dead client).
pool.on('error', (err) => {
  console.error('[pg pool] idle client error (connection recovered):', err);
});

module.exports = pool;
