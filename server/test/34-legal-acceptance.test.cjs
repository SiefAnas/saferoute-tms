// Terms / Privacy (branch account-settings): GET /legal/:document serves the server's own copy
// (server/src/legal), the server refuses to start without it, registration is refused without the
// checkbox, and with it two legal_acceptances rows are written (versions from that copy's
// frontmatter, plus the request IP) in the same transaction.
const PG_PORT = 5492;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-34';
process.env.NODE_ENV = 'test';

const fs = require('node:fs');
const path = require('node:path');
const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { spawnSync } = require('node:child_process');
const { parseFrontmatter } = require('../src/services/legal.js');

const rec = createRecorder('34-legal-acceptance');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5993';
const PW = 'Secret123!';

const LEGAL_DIR = path.resolve(__dirname, '..', 'src', 'legal');
const fm = (doc) => parseFrontmatter(fs.readFileSync(path.join(LEGAL_DIR, `${doc}.md`), 'utf8'));

async function post(p, body) {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: data };
}
const base = (email, extra = {}) => ({ orgName: `Org ${email}`, address: '1 Main St', zip: '02139', state: 'MA', fullName: 'Owner', email, password: PW, ...extra });
const counts = async () => (await pool.query(
  "SELECT (SELECT count(*)::int FROM companies) + (SELECT count(*)::int FROM schools) AS orgs, (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM legal_acceptances) AS acc"
)).rows[0];

async function main() {
  const epg = await startEmbeddedPostgres('34-legal-acceptance', PG_PORT);
  try {
    runMigrateUp();
    const server = createApp().listen(5993);
    try {
      const terms = fm('terms');
      const privacy = fm('privacy');
      (terms.version && privacy.version && terms.effective && privacy.effective)
        ? ok(`both documents carry version + effective in their frontmatter (terms ${terms.version}, privacy ${privacy.version})`)
        : bad(`frontmatter: ${JSON.stringify({ terms, privacy })}`);
      for (const doc of ['terms', 'privacy']) {
        /PLACEHOLDER/.test(fs.readFileSync(path.join(LEGAL_DIR, `${doc}.md`), 'utf8')) ? ok(`${doc}.md is clearly marked PLACEHOLDER`) : bad(`${doc}.md has no PLACEHOLDER marker`);
      }
      const LEGAL = { terms: terms.version, privacy: privacy.version };
      eq('the old client copy is gone (one source of truth)', fs.existsSync(path.resolve(__dirname, '..', '..', 'client', 'src', 'legal')), false);

      console.log('--- GET /legal/:document (public) ---');
      for (const doc of ['terms', 'privacy']) {
        const r = await fetch(`${BASE}/legal/${doc}`);
        const b = await r.json();
        const file = fs.readFileSync(path.join(LEGAL_DIR, `${doc}.md`), 'utf8');
        eq(`${doc}: 200 without a token`, r.status, 200);
        eq(`${doc}: { document, version, effective, markdown }`, Object.keys(b).sort().join(','), 'document,effective,markdown,version');
        eq(`${doc}: values from the file`, JSON.stringify([b.document, b.version, b.effective, b.markdown]), JSON.stringify([doc, fm(doc).version, fm(doc).effective, file]));
      }
      for (const bad of ['cookies', '..%2F..%2Fpackage.json', 'terms.md', 'TERMS']) {
        eq(`GET /legal/${bad} -> 404`, (await fetch(`${BASE}/legal/${bad}`)).status, 404);
      }

      console.log('--- the server refuses to start without the files ---');
      const boot = (env) => spawnSync(process.execPath, ['src/index.js'], {
        cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 8000,
        env: { ...process.env, PORT: '0', ...env },
      });
      const missing = boot({ LEGAL_DIR: path.join(__dirname, '.tmp', 'no-such-legal-dir') });
      eq('missing folder: exits with code 1 (does not keep running)', missing.status, 1);
      /\[legal\] FATAL/.test(missing.stderr) && /Refusing to start/.test(missing.stderr)
        ? ok('...and says why on stderr') : bad(`stderr: ${missing.stderr}`);
      const brokenDir = path.join(__dirname, '.tmp', 'legal-broken');
      fs.mkdirSync(brokenDir, { recursive: true });
      fs.writeFileSync(path.join(brokenDir, 'terms.md'), '# no frontmatter');
      fs.copyFileSync(path.join(LEGAL_DIR, 'privacy.md'), path.join(brokenDir, 'privacy.md'));
      const broken = boot({ LEGAL_DIR: brokenDir });
      eq('a file without a version: exits with code 1', broken.status, 1);
      /terms\.md: frontmatter needs a "version"/.test(broken.stderr) ? ok('...naming the file and the problem') : bad(`stderr: ${broken.stderr}`);

      console.log('--- refused without the checkbox ---');
      const before = await counts();
      const none = await post('/signup/company', base('none@x.com'));
      eq('no acceptLegal -> 400', none.status, 400);
      eq('message names both documents', none.body?.error, 'you must agree to the Terms of Use and the Privacy Policy');
      eq('school signup without it -> 400 too', (await post('/signup/school', base('none@s.com'))).status, 400);
      eq('acceptLegal: true (no versions) -> 400', (await post('/signup/company', base('t@x.com', { acceptLegal: true }))).status, 400);
      eq('only the terms accepted -> 400', (await post('/signup/company', base('half@x.com', { acceptLegal: { terms: LEGAL.terms } }))).status, 400);
      eq('empty versions -> 400', (await post('/signup/company', base('empty@x.com', { acceptLegal: { terms: '', privacy: '' } }))).status, 400);
      const stale = await post('/signup/company', base('stale@x.com', { acceptLegal: { terms: '0.0-old', privacy: LEGAL.privacy } }));
      eq('an outdated version -> 409 (reload and agree again)', stale.status, 409);
      eq('nothing was created by any refused signup', JSON.stringify(await counts()), JSON.stringify(before));
      eq('a refused email can still sign up afterwards (no half-made account)', (await post('/signup/company', base('none@x.com', { acceptLegal: LEGAL }))).status, 201);

      console.log('\n--- with the checkbox: two acceptance rows ---');
      const okRes = await post('/signup/company', base('owner@x.com', { acceptLegal: LEGAL }));
      eq('company signup with acceptLegal -> 201', okRes.status, 201);
      const rows = (await pool.query(
        'SELECT a.document, a.version, a.ip, a.accepted_at > now() - interval \'1 minute\' AS recent FROM legal_acceptances a JOIN users u ON u.id = a.user_id WHERE u.email = $1 ORDER BY a.document',
        ['owner@x.com']
      )).rows;
      eq('exactly two rows for the new admin', rows.length, 2);
      eq('one per document', rows.map((r) => r.document).join(','), 'privacy,terms');
      eq('privacy version from privacy.md frontmatter', rows[0]?.version, privacy.version);
      eq('terms version from terms.md frontmatter', rows[1]?.version, terms.version);
      rows.every((r) => r.ip && /127\.0\.0\.1|::1/.test(r.ip)) ? ok(`request IP recorded (${rows[0]?.ip})`) : bad(`ip: ${JSON.stringify(rows.map((r) => r.ip))}`);
      eq('accepted_at is now', rows.every((r) => r.recent), true);

      const school = await post('/signup/school', base('head@s.com', { acceptLegal: LEGAL }));
      eq('school signup with acceptLegal -> 201', school.status, 201);
      eq('school admin gets two rows too', (await pool.query('SELECT count(*)::int AS n FROM legal_acceptances a JOIN users u ON u.id = a.user_id WHERE u.email = $1', ['head@s.com'])).rows[0].n, 2);

      const dup = await post('/signup/company', base('owner@x.com', { acceptLegal: LEGAL }));
      eq('duplicate email -> 409, still no extra rows', `${dup.status}/${(await counts()).acc}`, '409/6');
    } finally {
      server.close();
    }
  } finally {
    try { await pool.end(); } catch { /* already ended */ }
    await epg.stop();
  }
  const { fail } = rec.summarize();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
