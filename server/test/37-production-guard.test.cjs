// Production guard (branch prod-safety-and-import-fix): a non-local DATABASE_URL is refused unless
// ALLOW_PRODUCTION_DB is exactly "yes", by the one rule in src/db/productionGuard.js, wherever it
// runs: API startup, the shared pool, the migration scripts, the seed and the e2e script. Each
// entry point is started as its own process. The "remote" host is under .invalid, which can never
// resolve, so nothing here can reach a real database even when the guard lets it through.
const PG_PORT = 5495;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-37';
process.env.NODE_ENV = 'test';
delete process.env.ALLOW_PRODUCTION_DB;

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRecorder, startEmbeddedPostgres, SERVER_DIR } = require('./lib/testkit.cjs');
const { checkTarget } = require('../src/db/productionGuard.js');

const rec = createRecorder('37-production-guard');
const { ok, bad, eq } = rec;

const REMOTE_HOST = 'prod-db.example.invalid';
const REMOTE = `postgres://u:p@${REMOTE_HOST}:5432/live?sslmode=require`;
const LOCAL = process.env.DATABASE_URL;
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Runs a command in server/ with exactly these overrides (never inheriting ALLOW_PRODUCTION_DB).
function run(cmd, args, env, timeout = 20000) {
  const childEnv = { ...process.env, NODE_ENV: 'development', ...env };
  if (!('ALLOW_PRODUCTION_DB' in env)) delete childEnv.ALLOW_PRODUCTION_DB;
  return spawnSync(cmd, args, { cwd: SERVER_DIR, env: childEnv, encoding: 'utf8', timeout, shell: cmd === NPM });
}
const refused = (res) => res.status === 1 && res.stderr.includes('REFUSING TO') && res.stderr.includes(REMOTE_HOST) && res.stderr.includes('ALLOW_PRODUCTION_DB=yes');

async function main() {
  console.log('--- the rule (checkTarget) ---');
  const c = (url, flag) => checkTarget(url, flag === undefined ? {} : { ALLOW_PRODUCTION_DB: flag }).ok;
  eq('localhost, no flag -> allowed', c('postgres://a:b@localhost:5432/x'), true);
  eq('127.0.0.1, no flag -> allowed', c('postgres://a:b@127.0.0.1/x'), true);
  eq('[::1], no flag -> allowed', c('postgres://a:b@[::1]:5432/x'), true);
  eq('remote, no flag -> refused', c(REMOTE), false);
  eq('remote, flag "yes" -> allowed', c(REMOTE, 'yes'), true);
  for (const v of ['YES', 'Yes', 'true', '1', 'y', ' yes', '']) eq(`remote, flag ${JSON.stringify(v)} -> refused (only exactly "yes")`, c(REMOTE, v), false);
  eq('localhost with ?host=<remote> -> refused (that host is where pg really connects)', c(`postgres://a:b@localhost/x?host=${REMOTE_HOST}`), false);
  eq('"localhost" as a subdomain of a remote host -> refused', c('postgres://a:b@localhost.evil.example/x'), false);
  eq('missing DATABASE_URL -> refused', c(undefined), false);
  eq('not a URL -> refused', c('nonsense'), false);
  eq('names the host it refused', JSON.stringify(checkTarget(REMOTE, {}).hosts), JSON.stringify([REMOTE_HOST]));

  console.log('\n--- API startup (src/index.js) ---');
  const api = run(process.execPath, ['src/index.js'], { DATABASE_URL: REMOTE, PORT: '0' });
  refused(api) ? ok('remote + no flag: exits 1, message names the host and ALLOW_PRODUCTION_DB=yes') : bad(`status=${api.status} stderr=${api.stderr}`);
  eq('...and never started listening', /listening/.test(api.stdout), false);
  console.log(api.stderr.split('\n').slice(0, 14).map((l) => `      | ${l}`).join('\n'));
  const apiYes = run(process.execPath, ['-e', "require('./src/db/productionGuard').assertTargetAllowed({purpose:'start the API'}); require('./src/app'); console.log('APP LOADED')"], { DATABASE_URL: REMOTE, ALLOW_PRODUCTION_DB: 'yes' });
  (apiYes.status === 0 && /APP LOADED/.test(apiYes.stdout)) ? ok('remote + ALLOW_PRODUCTION_DB=yes: proceeds (app loads)') : bad(`status=${apiYes.status} ${apiYes.stderr}`);
  const apiYesBoot = run(process.execPath, ['src/index.js'], { DATABASE_URL: REMOTE, ALLOW_PRODUCTION_DB: 'yes', PORT: '0' }, 4000);
  /listening/.test(apiYesBoot.stdout) ? ok('remote + flag: src/index.js gets as far as listening') : bad(`stdout=${apiYesBoot.stdout} stderr=${apiYesBoot.stderr}`);
  const apiLocal = run(process.execPath, ['src/index.js'], { DATABASE_URL: LOCAL, PORT: '0' }, 4000);
  /listening/.test(apiLocal.stdout) && !apiLocal.stderr.includes('REFUSING') ? ok('localhost + no flag: starts listening') : bad(`stdout=${apiLocal.stdout} stderr=${apiLocal.stderr}`);

  console.log('\n--- the shared pool (any script) ---');
  const pool = run(process.execPath, ['-e', "require('./src/db/pool'); console.log('POOL READY')"], { DATABASE_URL: REMOTE });
  refused(pool) && !/POOL READY/.test(pool.stdout) ? ok('requiring the pool with a remote URL and no flag exits 1') : bad(`status=${pool.status} stderr=${pool.stderr}`);
  const poolYes = run(process.execPath, ['-e', "require('./src/db/pool'); console.log('POOL READY')"], { DATABASE_URL: REMOTE, ALLOW_PRODUCTION_DB: 'yes' });
  eq('...proceeds with the flag', /POOL READY/.test(poolYes.stdout), true);
  const claims = run(process.execPath, ['scripts/claim-requests.js', 'list'], { DATABASE_URL: REMOTE });
  refused(claims) ? ok('an existing script with no guard of its own (claim-requests.js) is covered through the pool') : bad(`status=${claims.status} stderr=${claims.stderr}`);

  console.log('\n--- migrations (npm run migrate:up) ---');
  const epg = await startEmbeddedPostgres('37-production-guard', PG_PORT);
  try {
    const mig = run(NPM, ['run', 'migrate:up'], { DATABASE_URL: REMOTE }, 60000);
    refused(mig) ? ok('remote + no flag: exits 1 with the message') : bad(`status=${mig.status} stderr=${mig.stderr.slice(-600)}`);
    eq('...node-pg-migrate never tried to connect (no DNS lookup of the host)', /ENOTFOUND|getaddrinfo|EAI_AGAIN/.test(mig.stdout + mig.stderr), false);
    const migYes = run(NPM, ['run', 'migrate:up'], { DATABASE_URL: REMOTE, ALLOW_PRODUCTION_DB: 'yes' }, 60000);
    (migYes.status !== 0 && /ENOTFOUND|getaddrinfo|EAI_AGAIN/.test(migYes.stdout + migYes.stderr) && !migYes.stderr.includes('REFUSING'))
      ? ok('remote + flag "yes": passes the guard and node-pg-migrate tries the host (fails only because .invalid never resolves)')
      : bad(`status=${migYes.status} out=${(migYes.stdout + migYes.stderr).slice(-600)}`);
    const migLocal = run(NPM, ['run', 'migrate:up'], { DATABASE_URL: LOCAL }, 120000);
    eq('localhost + no flag: migrations run (exit 0)', migLocal.status, 0);
    /MIGRATION .* \(UP\)/.test(migLocal.stdout) ? ok('...and actually applied them') : bad(`stdout tail: ${migLocal.stdout.slice(-400)}`);
  } finally {
    await epg.stop();
  }

  console.log('\n--- seed and e2e use the same rule ---');
  const seed = run(process.execPath, ['scripts/seed-dummy-data.js'], { DATABASE_URL: REMOTE });
  refused(seed) ? ok('seed: remote + no flag refused with the shared message') : bad(`status=${seed.status} stderr=${seed.stderr}`);
  const seedOldFlag = run(process.execPath, ['scripts/seed-dummy-data.js'], { DATABASE_URL: REMOTE, ALLOW_REMOTE_SEED: '1' });
  eq('seed: the old ALLOW_REMOTE_SEED=1 no longer opens it', refused(seedOldFlag), true);
  const e2eApi = run(process.execPath, ['scripts/e2e-roles.mjs'], { API_BASE: `https://${REMOTE_HOST}`, DATABASE_URL: '' });
  (e2eApi.status === 1 && e2eApi.stderr.includes(REMOTE_HOST) && e2eApi.stderr.includes('API_BASE')) ? ok('e2e: a remote API_BASE is refused, naming the host') : bad(`status=${e2eApi.status} stderr=${e2eApi.stderr}`);
  const e2eDb = run(process.execPath, ['scripts/e2e-roles.mjs'], { API_BASE: 'http://localhost:1', DATABASE_URL: REMOTE });
  refused(e2eDb) ? ok('e2e: a remote DATABASE_URL is refused') : bad(`status=${e2eDb.status} stderr=${e2eDb.stderr}`);
  const e2eOldFlag = run(process.execPath, ['scripts/e2e-roles.mjs'], { API_BASE: `https://${REMOTE_HOST}`, DATABASE_URL: '', ALLOW_REMOTE_E2E: '1' });
  eq('e2e: the old ALLOW_REMOTE_E2E=1 no longer opens it', e2eOldFlag.status, 1);

  const { fail } = rec.summarize();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
