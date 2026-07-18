// Shared transaction helper: runs fn with a single client across BEGIN/COMMIT/ROLLBACK.
// Extracted from services/signup.js so other services needing atomicity (e.g. Trips'
// insert + trip_count bump) don't duplicate the same connect/begin/commit/rollback/release.
const pool = require('./pool');

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { withTx };
