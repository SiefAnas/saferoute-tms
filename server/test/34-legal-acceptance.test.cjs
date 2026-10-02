// Terms / Privacy acceptance at signup (branch account-settings): registration is refused
// without the checkbox, and with it two legal_acceptances rows are written (versions from the
// markdown frontmatter in client/src/legal, plus the request IP) in the same transaction.
const PG_PORT = 5492;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-34';
process.env.NODE_ENV = 'test';

const fs = require('node:fs');
const path = require('node:path');
const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { parseFrontmatter } = require('../src/services/legal.js');

const rec = createRecorder('34-legal-acceptance');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5993';
const PW = 'Secret123!';

const LEGAL_DIR = path.resolve(__dirname, '..', '..', 'client', 'src', 'legal');
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
