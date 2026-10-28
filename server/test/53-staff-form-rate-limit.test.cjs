// Rate limits on the public staff info form and the "choose your password" setup page, with the
// real limiters on (RATE_LIMIT_FORCE=1) and small caps so a few calls reach them.
const PG_PORT = 5534;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-53';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_FORCE = '1';
process.env.RATE_LIMIT_LOGIN_MAX = '1000';
process.env.RATE_LIMIT_STAFF_FORM_MAX = '4';
process.env.RATE_LIMIT_SETUP_MAX = '3';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('53-staff-form-rate-limit');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:6046';
const PW = 'Secret123!';

async function api(method, p, token, body) {
  const opts = { method, headers: {} };
  if (token) opts.headers.authorization = `Bearer ${token}`;
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(BASE + p, opts);
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: data };
}

async function main() {
  const epg = await startEmbeddedPostgres('53-staff-form-rate-limit', PG_PORT);
  try {
    runMigrateUp();
    const A = (await pool.query("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id")).rows[0];
    await pool.query(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('a1@a.com',$1,'a1','company_admin',$2,now())",
      [await hashPassword(PW), A.id]
    );

    const server = createApp().listen(6046);
    try {
      const tA = (await api('POST', '/auth/login', null, { email: 'a1@a.com', password: PW })).body.token;
      const code = /code=([0-9a-f]{64})/.exec((await api('POST', '/staff-links', tA, { role: 'monitor', expires_in_days: 3 })).body.url)[1];
      const form = (n) => ({ code, full_name: `Mo ${n}`, phone: '555-0101', email: `mo${n}@example.com` });

      console.log('--- public form: 4 calls per window, shared by every /staff-form route ---');
      eq('1: open the link -> 200', (await api('POST', '/staff-form/link', null, { code })).status, 200);
      eq('2: submit -> 201', (await api('POST', '/staff-form/submit', null, form(1))).status, 201);
      eq('3: a guessed code still counts -> 410', (await api('POST', '/staff-form/link', null, { code: 'f'.repeat(64) })).status, 410);
      eq('4: submit -> 201', (await api('POST', '/staff-form/submit', null, form(2))).status, 201);
      const limited = await api('POST', '/staff-form/submit', null, form(3));
      (limited.status === 429 && /too many attempts/.test(limited.body?.error ?? '')) ? ok('5th call -> 429 too many attempts') : bad(`5th: ${limited.status} ${JSON.stringify(limited.body)}`);
      eq('the blocked submit saved nothing', (await pool.query("SELECT count(*)::int AS n FROM staff_submissions WHERE email = 'mo3@example.com'")).rows[0].n, 0);
      eq('other routes of the form are blocked too -> 429', (await api('POST', '/staff-form/mine', null, { code, edit_token: 'a'.repeat(64) })).status, 429);
      eq('signed-in admin routes are not affected', (await api('GET', '/staff-submissions', tA)).status, 200);

      console.log('\n--- setup page: 3 calls per window ---');
      for (let i = 1; i <= 3; i++) {
        eq(`${i}: a wrong setup token -> 400`, (await api('POST', '/auth/setup-account', null, { token: 'b'.repeat(64), newPassword: 'MyOwnPass9!' })).status, 400);
      }
      const setupLimited = await api('POST', '/auth/setup-account', null, { token: 'b'.repeat(64), newPassword: 'MyOwnPass9!' });
      (setupLimited.status === 429 && /too many attempts/.test(setupLimited.body?.error ?? '')) ? ok('4th setup call -> 429 too many attempts') : bad(`4th setup: ${setupLimited.status} ${JSON.stringify(setupLimited.body)}`);
      eq('login has its own budget and still works', (await api('POST', '/auth/login', null, { email: 'a1@a.com', password: PW })).status, 200);
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
