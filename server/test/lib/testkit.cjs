// Shared test-harness helpers: spin up an isolated embedded PostgreSQL per suite,
// run the real `migrate:up` CLI against it, and a tiny pass/fail recorder in the
// same style used throughout the Step 1-3 live verification.
const path = require('node:path');
const { rmSync } = require('node:fs');
const { execSync } = require('node:child_process');

const SERVER_DIR = path.resolve(__dirname, '..', '..'); // server/

function createRecorder(label) {
  let pass = 0;
  let fail = 0;
  const ok = (msg) => { pass++; console.log('  ✓', msg); };
  const bad = (msg) => { fail++; console.log('  ✗ FAIL:', msg); };
  const eq = (msg, got, want) =>
    (got === want ? ok(msg) : bad(`${msg} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`));
  const summarize = () => {
    console.log(`\n==== ${label}: ${pass} passed, ${fail} failed ====`);
    return { pass, fail };
  };
  return { ok, bad, eq, summarize };
}

async function startEmbeddedPostgres(name, port = 5432) {
  const EmbeddedPostgresPkg = require('embedded-postgres');
  const EmbeddedPostgres = EmbeddedPostgresPkg.default || EmbeddedPostgresPkg;
  const dataDir = path.join(SERVER_DIR, 'test', '.tmp', name);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* first run: nothing to remove */ }
  const epg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'saferoute',
    password: 'saferoute',
    port,
    persistent: false,
  });
  await epg.initialise();
  await epg.start();
  await epg.createDatabase('saferoute_dev');

  // On Windows, embedded-postgres's post-stop directory cleanup can hit a transient
  // file lock (EBUSY) right after the server process exits. That's teardown noise, not
  // a correctness failure — swallow it so it can't flip an otherwise-passing suite to FAIL.
  const realStop = epg.stop.bind(epg);
  epg.stop = async () => {
    try {
      await realStop();
    } catch (err) {
      console.warn(`[testkit] embedded-postgres stop/cleanup warning (non-fatal): ${err.message}`);
    }
  };
  return epg;
}

function runMigrateUp({ silent = true } = {}) {
  execSync('npm run migrate:up', { cwd: SERVER_DIR, stdio: silent ? 'ignore' : 'inherit' });
}

module.exports = { createRecorder, startEmbeddedPostgres, runMigrateUp, SERVER_DIR };
