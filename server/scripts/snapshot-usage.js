// Writes today's usage (students, drivers, monitors, vans, schools) for every company into
// usage_snapshots, one row per company per day. Runs against DATABASE_URL from server/.env, i.e.
// whatever database the app points at. Not scheduled anywhere yet: run it by hand (or from a
// cron job once one is set up).
//
//   node scripts/snapshot-usage.js --dry-run   prints what it would write, writes nothing
//   node scripts/snapshot-usage.js             writes
//
// Idempotent: running it again the same day updates that day's rows to the current numbers
// (unique on company + day), it never adds a second row. "Today" is the database's CURRENT_DATE,
// like every other "today" in the app. Counts are the same as GET /companies/me/usage
// (src/services/usage.js). Only real companies are counted (claim_status 'claimed'): unclaimed
// placeholders have no users and nobody to bill.
require('dotenv').config();
const pool = require('../src/db/pool');
const { USAGE_SQL } = require('../src/services/usage');

const COLUMNS = ['students', 'drivers', 'monitors', 'vans', 'schools'];

async function snapshotUsage({ dryRun = false, log = console.log } = {}) {
  const { rows: [{ today }] } = await pool.query('SELECT CURRENT_DATE::text AS today');
  const { rows: companies } = await pool.query("SELECT id, name FROM companies WHERE claim_status = 'claimed' ORDER BY name");
  const results = [];
  for (const c of companies) {
    const counts = (await pool.query(USAGE_SQL, [c.id])).rows[0];
    results.push({ company_id: c.id, name: c.name, ...counts });
    log(`${dryRun ? '[dry run] ' : ''}${today}  ${c.name}  ${COLUMNS.map((k) => `${k}=${counts[k]}`).join(' ')}`);
    if (dryRun) continue;
    await pool.query(
      `INSERT INTO usage_snapshots (company_id, captured_on, ${COLUMNS.join(', ')})
       VALUES ($1, CURRENT_DATE, ${COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (company_id, captured_on) DO UPDATE SET ${COLUMNS.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}`,
      [c.id, ...COLUMNS.map((k) => counts[k])]
    );
  }
  log(`${dryRun ? 'Dry run: nothing written' : 'Written'} for ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'} (${today}).`);
  return { today, results };
}

if (require.main === module) {
  const host = (() => {
    try { return new URL(process.env.DATABASE_URL).host; } catch { return '(DATABASE_URL not set)'; }
  })();
  console.log(`Database: ${host}`);
  snapshotUsage({ dryRun: process.argv.includes('--dry-run') })
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}

module.exports = { snapshotUsage };
