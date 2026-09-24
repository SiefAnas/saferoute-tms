// Runs scripts/cleanup-test-data.sql against DATABASE_URL (server/.env).
//   node scripts/cleanup-run.cjs            dry run: the same statements, then ROLLBACK
//   node scripts/cleanup-run.cjs --commit   really deletes
// Prints how many rows each DELETE removes (or would remove). No row data is printed.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const commit = process.argv.includes('--commit');
let sql = fs.readFileSync(path.join(__dirname, 'cleanup-test-data.sql'), 'utf8');
if (!commit) sql = sql.replace(/^COMMIT;\s*$/m, 'ROLLBACK;');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const results = await client.query(sql);
    const deletes = sql.match(/^DELETE FROM \w+/gm);
    const counts = results.filter((r) => r.command === 'DELETE');
    console.log(commit ? 'DELETED (committed):' : 'DRY RUN (rolled back, nothing changed):');
    counts.forEach((r, i) => console.log(`  ${deletes[i].padEnd(28)} ${r.rowCount}`));
  } catch (e) {
    console.error('Stopped, nothing deleted:', e.message);
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
main();
