// Single shared pg connection pool.
const { Pool } = require('pg');
const { databaseUrl } = require('../config');

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
