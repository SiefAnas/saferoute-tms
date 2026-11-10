// First-sign-in agreement (branch legal-gate): a signed-in user who has not accepted the current
// Terms of Use and Privacy Policy gets 403 LEGAL_ACCEPTANCE_REQUIRED everywhere except
// /auth/me, /auth/change-password and POST /legal/accept. The password change comes first.
// Login and change-password report legal_pending; accepting writes one row per document, once.
// A new version of a document makes the user pending again.
const PG_PORT = 5494;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-55';
process.env.NODE_ENV = 'test';
process.env.LEGAL_GATE = 'on';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const { currentVersions } = require('../src/services/legal.js');

const rec = createRecorder('55-legal-gate');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5995';
const PW = 'Secret123!';

async function call(method, p, token, body) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: data };
}
const login = (email, password = PW) => call('POST', '/auth/login', null, { email, password });
const accRows = async (email) => (await pool.query(
  'SELECT a.document, a.version FROM legal_acceptances a JOIN users u ON u.id = a.user_id WHERE u.email = $1 ORDER BY a.document', [email]
)).rows;

async function main() {
  const epg = await startEmbeddedPostgres('55-legal-gate', PG_PORT);
  try {
    runMigrateUp();
    const server = createApp().listen(5995);
    try {
      const LEGAL = currentVersions();
      const hash = await hashPassword(PW);
      const company = (await pool.query("INSERT INTO companies(name, claim_status, claimed_at) VALUES ('Gate Co', 'claimed', now()) RETURNING id")).rows[0];
      const addUser = (email, role, extra = '') => pool.query(
        `INSERT INTO users(email, password_hash, full_name, role, company_id, email_verified_at, is_active${extra ? ', must_change_password, temp_password_expires_at' : ''})
         VALUES ($1, $2, $3, $4, $5, now(), true${extra ? ", true, now() + interval '7 days'" : ''}) RETURNING id`,
        [email, hash, `User ${email}`, role, company.id]
      ).then((r) => r.rows[0]);
      await addUser('admin@gate.com', 'company_admin');
      await addUser('driver@gate.com', 'driver');
      await addUser('temp@gate.com', 'driver', 'temp');

      console.log('--- a user who has not agreed yet ---');
      const l1 = await login('admin@gate.com');
      eq('login -> 200', l1.status, 200);
      eq('login says legal_pending: true', l1.body?.user?.legal_pending, true);
      const t1 = l1.body.token;
      const blocked = await call('GET', '/users', t1);
      eq('any other route -> 403', blocked.status, 403);
      eq('...with code LEGAL_ACCEPTANCE_REQUIRED', blocked.body?.code, 'LEGAL_ACCEPTANCE_REQUIRED');
      const me = await call('GET', '/auth/me', t1);
      eq('/auth/me stays open (200)', me.status, 200);
      eq('/auth/me reports legalPending: true', me.body?.user?.legalPending, true);
      eq('GET /legal/terms stays public', (await call('GET', '/legal/terms')).status, 200);

      console.log('--- POST /legal/accept ---');
      eq('without a token -> 401', (await call('POST', '/legal/accept', null, LEGAL)).status, 401);
      eq('no versions -> 400', (await call('POST', '/legal/accept', t1, {})).status, 400);
      eq('only the terms -> 400', (await call('POST', '/legal/accept', t1, { terms: LEGAL.terms })).status, 400);
      eq('an outdated version -> 409', (await call('POST', '/legal/accept', t1, { terms: '0.0-old', privacy: LEGAL.privacy })).status, 409);
      eq('nothing recorded by the refused attempts', (await accRows('admin@gate.com')).length, 0);
      const acc = await call('POST', '/legal/accept', t1, LEGAL);
      eq('the current versions -> 200', acc.status, 200);
      eq('...answers legal_pending: false', acc.body?.legal_pending, false);
      const rows = await accRows('admin@gate.com');
      eq('two rows, one per document, at the current versions', JSON.stringify(rows), JSON.stringify([{ document: 'privacy', version: LEGAL.privacy }, { document: 'terms', version: LEGAL.terms }]));
      eq('accepting again (double tap) -> 200', (await call('POST', '/legal/accept', t1, LEGAL)).status, 200);
      eq('...and writes no duplicate rows', (await accRows('admin@gate.com')).length, 2);
      eq('the same token now reaches other routes (GET /users -> 200)', (await call('GET', '/users', t1)).status, 200);
      eq('the next login says legal_pending: false', (await login('admin@gate.com')).body?.user?.legal_pending, false);

      console.log('--- the gate holds for every role ---');
      const t2 = (await login('driver@gate.com')).body.token;
      const d = await call('GET', '/users', t2);
      eq('a driver who has not agreed gets LEGAL_ACCEPTANCE_REQUIRED (before the role check)', d.body?.code, 'LEGAL_ACCEPTANCE_REQUIRED');
      eq('the driver accepts -> 200', (await call('POST', '/legal/accept', t2, LEGAL)).status, 200);
      const d2 = await call('GET', '/users', t2);
      (d2.body?.code !== 'LEGAL_ACCEPTANCE_REQUIRED') ? ok(`after agreeing the driver gets the normal answer (${d2.status})`) : bad('still LEGAL_ACCEPTANCE_REQUIRED');

      console.log('--- temporary password: the password change comes first ---');
      const l3 = await login('temp@gate.com');
      eq('login reports both: must_change_password and legal_pending', `${l3.body?.user?.must_change_password}/${l3.body?.user?.legal_pending}`, 'true/true');
      const t3 = l3.body.token;
      const early = await call('POST', '/legal/accept', t3, LEGAL);
      eq('accepting before the password change -> 403 PASSWORD_CHANGE_REQUIRED', `${early.status}/${early.body?.code}`, '403/PASSWORD_CHANGE_REQUIRED');
      eq('other routes still say PASSWORD_CHANGE_REQUIRED first', (await call('GET', '/users', t3)).body?.code, 'PASSWORD_CHANGE_REQUIRED');
      const ch = await call('POST', '/auth/change-password', t3, { currentPassword: PW, newPassword: 'Another123!' });
      eq('change-password -> 200', ch.status, 200);
      eq('...its new session still says legal_pending: true', ch.body?.user?.legal_pending, true);
      const t3b = ch.body.token;
      eq('now other routes say LEGAL_ACCEPTANCE_REQUIRED', (await call('GET', '/users', t3b)).body?.code, 'LEGAL_ACCEPTANCE_REQUIRED');
      eq('accepting now -> 200', (await call('POST', '/legal/accept', t3b, LEGAL)).status, 200);

      console.log('--- a new version makes everyone agree again ---');
      await pool.query("UPDATE legal_acceptances SET version = '0.9-old' WHERE document = 'terms' AND user_id = (SELECT id FROM users WHERE email = 'admin@gate.com')");
      const again = await call('GET', '/users', t1);
      eq('an older accepted terms version -> 403 LEGAL_ACCEPTANCE_REQUIRED again', again.body?.code, 'LEGAL_ACCEPTANCE_REQUIRED');
      eq('login says legal_pending: true again', (await login('admin@gate.com')).body?.user?.legal_pending, true);
      eq('accepting the new version -> 200', (await call('POST', '/legal/accept', t1, LEGAL)).status, 200);
      eq('the old row is kept as history and the new one added', (await accRows('admin@gate.com')).length, 3);
      eq('and the user is through again', (await call('GET', '/users', t1)).status, 200);
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
