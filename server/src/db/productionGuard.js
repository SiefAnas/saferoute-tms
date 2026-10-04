// The one rule for "is this about to touch a real database?" (branch prod-safety-and-import-fix).
//
// A target that isn't this machine (localhost / 127.0.0.1 / ::1) is refused unless
// ALLOW_PRODUCTION_DB is exactly "yes". It's checked by:
//   - the API at startup (src/index.js) and the shared pool (src/db/pool.js), so every script that
//     talks to the database goes through it, including ones written later;
//   - the migration runner (scripts/check-db-target.js, chained before node-pg-migrate in the
//     npm migrate scripts);
//   - scripts/seed-dummy-data.js and scripts/e2e-roles.mjs (which also checks the API it calls).
// On Render, ALLOW_PRODUCTION_DB=yes must be set on the API service, or it refuses to start.
//
// Why: a server/.env pointing at production Neon turned an ordinary local "start the API" into a
// production action without any warning (seen 2026-10-02).
require('../config'); // loads server/.env first, exactly like the app and node-pg-migrate do

const FLAG = 'ALLOW_PRODUCTION_DB';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// The host a connection string really points at. A `host=` query parameter overrides the host in
// the authority for node-postgres, so it's checked too (otherwise
// "postgres://localhost/db?host=prod.example.com" would look local and connect to prod).
function targetHosts(url) {
  if (!url) return { hosts: [], error: 'is not set' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { hosts: [], error: 'is not a valid URL' };
  }
  const hosts = [];
  if (parsed.hostname) hosts.push(parsed.hostname);
  for (const h of parsed.searchParams.getAll('host')) hosts.push(h);
  if (!hosts.length) return { hosts: [], error: 'has no host' };
  return { hosts, error: null };
}

function isLocalHost(host) {
  return LOCAL_HOSTS.has(String(host).toLowerCase());
}

// { ok, hosts, reason }. Pure: no printing, no exiting (the tests call this directly).
function checkTarget(url, env = process.env) {
  const { hosts, error } = targetHosts(url);
  if (error) return { ok: false, hosts, reason: error };
  const remote = hosts.filter((h) => !isLocalHost(h));
  if (!remote.length) return { ok: true, hosts, reason: 'local' };
  if (env[FLAG] === 'yes') return { ok: true, hosts, reason: `${FLAG}=yes` };
  return { ok: false, hosts: remote, reason: 'remote' };
}

function refusalMessage(label, url, result, purpose) {
  const line = '='.repeat(78);
  const what = result.reason === 'remote'
    ? `${label} points at a database that is NOT on this machine:\n\n      host: ${result.hosts.join(', ')}\n`
    : `${label} ${result.reason}${url ? '' : ' (nothing to connect to)'}.\n`;
  return [
    '',
    line,
    `  REFUSING TO ${purpose.toUpperCase()}: possible production database`,
    line,
    '',
    `  ${what}`,
    `  Anything that only runs on this machine must use localhost / 127.0.0.1.`,
    `  If you really mean to reach that host (the live API on Render, or a migration you`,
    `  are running against production on purpose), set:`,
    '',
    `      ${FLAG}=yes`,
    '',
    `  It is currently ${process.env[FLAG] === undefined ? 'not set' : `"${process.env[FLAG]}" (only exactly "yes" counts)`}.`,
    `  Nothing was connected to. Exiting.`,
    line,
    '',
  ].join('\n');
}

// Prints the loud message and exits with code 1 if the target isn't allowed. `label` names the
// setting in the message ("DATABASE_URL", "API_BASE"); `purpose` says what was about to happen.
function assertTargetAllowed({ url = process.env.DATABASE_URL, label = 'DATABASE_URL', purpose = 'start' } = {}) {
  const result = checkTarget(url);
  if (result.ok) return result;
  console.error(refusalMessage(label, url, result, purpose));
  process.exit(1);
}

module.exports = { FLAG, isLocalHost, targetHosts, checkTarget, assertTargetAllowed };
