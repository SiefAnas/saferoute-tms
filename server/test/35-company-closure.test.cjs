// Company closure, request side only (branch account-settings): POST /companies/me/closure
// (company_admin, password + exact company name), everyone signed out and refused at login and
// on every request while closing (ACCOUNT_CLOSING, with undo instructions), the undo link
// (DELETE /companies/me/closure?token=, public, only before the purge date), and nothing deleted.
const PG_PORT = 5493;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-35';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const mailer = require('../src/mail/mailer.js');

const rec = createRecorder('35-company-closure');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5994';
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
const login = (email, password = PW) => api('POST', '/auth/login', null, { email, password });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const epg = await startEmbeddedPostgres('35-company-closure', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const q = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await q("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Acme Rides, Inc.','claimed',now()) RETURNING id");
    const B = await q("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Other Co','claimed',now()) RETURNING id");
    const S = await q("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const user = (email, role, col, id) => q(
      `INSERT INTO users(email,password_hash,full_name,role,${col},email_verified_at) VALUES($1,$2,$1,$3,$4,now()) RETURNING id`,
      [email, hash, role, id]
    );
    const admin = await user('admin@a.com', 'company_admin', 'company_id', A.id);
    await user('admin2@a.com', 'company_admin', 'company_id', A.id);
    for (const [e, r] of [['d@a.com', 'driver'], ['m@a.com', 'monitor'], ['p@a.com', 'parent']]) await user(e, r, 'company_id', A.id);
    await user('admin@b.com', 'company_admin', 'company_id', B.id);
    await user('sa@s.com', 'school_admin', 'school_id', S.id);
    await q("INSERT INTO students(company_id,school_id,full_name,grade) VALUES($1,$2,'Kid','3')", [A.id, S.id]);
    await q("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'AAA-111','Ford','Transit',2022)", [A.id]);
    const snapshot = async () => (await pool.query(
      `SELECT (SELECT count(*) FROM users WHERE company_id = $1) || '/' || (SELECT count(*) FROM students WHERE company_id = $1) || '/' ||
              (SELECT count(*) FROM vans WHERE company_id = $1) AS n`, [A.id]
    )).rows[0].n;
    const before = await snapshot();

    const server = createApp().listen(5994);
    try {
      const tok = {};
      for (const e of ['admin@a.com', 'admin2@a.com', 'd@a.com', 'm@a.com', 'p@a.com', 'admin@b.com', 'sa@s.com']) tok[e] = (await login(e)).body.token;
      const NAME = 'Acme Rides, Inc.';

      console.log('--- who can ask, and the checks ---');
      for (const e of ['d@a.com', 'm@a.com', 'p@a.com', 'sa@s.com']) {
        eq(`${e}: POST closure -> 403`, (await api('POST', '/companies/me/closure', tok[e], { currentPassword: PW, confirmName: NAME })).status, 403);
      }
      eq('no token -> 401', (await api('POST', '/companies/me/closure', null, { currentPassword: PW, confirmName: NAME })).status, 401);
      const wrongPw = await api('POST', '/companies/me/closure', tok['admin@a.com'], { currentPassword: 'Wrong123!', confirmName: NAME });
      eq('wrong password -> 400', `${wrongPw.status} ${wrongPw.body?.error}`, '400 current password is incorrect');
      for (const name of ['acme rides, inc.', 'Acme Rides, Inc. ', ' Acme Rides, Inc.', 'Acme Rides', '']) {
        eq(`confirmName ${JSON.stringify(name)} -> 400 (must match exactly)`, (await api('POST', '/companies/me/closure', tok['admin@a.com'], { currentPassword: PW, confirmName: name })).status, 400);
      }
      eq('missing fields -> 400', (await api('POST', '/companies/me/closure', tok['admin@a.com'], {})).status, 400);
      eq('nothing changed by refused requests', (await q('SELECT billing_status FROM companies WHERE id = $1', [A.id])).billing_status, 'free');
      eq('everyone still signed in', (await api('GET', '/users/me', tok['d@a.com'])).status, 200);

      console.log('\n--- request ---');
      mailer._reset();
      await sleep(1100); // sessions are compared to the second
      const req1 = await api('POST', '/companies/me/closure', tok['admin@a.com'], { currentPassword: PW, confirmName: NAME });
      eq('admin with password + exact name -> 200', req1.status, 200);
      const c = await q(
        `SELECT billing_status, closure_requested_by, closure_undo_token_hash,
                closure_requested_at > now() - interval '1 minute' AS recent,
                closure_purge_at = closure_requested_at + interval '30 days' AS thirty_days
           FROM companies WHERE id = $1`, [A.id]
      );
      eq('billing_status closing', c.billing_status, 'closing');
      eq('closure_requested_at = now', c.recent, true);
      eq('closure_purge_at = requested + 30 calendar days (DST-safe)', c.thirty_days, true);
      eq('closure_requested_by = the admin', c.closure_requested_by, admin.id);
      const mail = (await mailer._drained()).at(-1);
      eq('undo email goes to the admin who asked', mail?.to, 'admin@a.com');
      const raw = /company-closure\/undo\?token=([0-9a-f]{64})/.exec(mail?.text ?? '')?.[1];
      raw ? ok('the email carries the undo link') : bad(`mail: ${mail?.text}`);
      (c.closure_undo_token_hash && c.closure_undo_token_hash !== raw) ? ok('only a hash of the undo token is stored') : bad('raw token stored or none');

      console.log('\n--- everyone is out while closing ---');
      for (const e of ['admin@a.com', 'admin2@a.com', 'd@a.com', 'm@a.com', 'p@a.com']) {
        const r = await api('GET', '/auth/me', tok[e]);
        eq(`${e}: existing session -> 401 ACCOUNT_CLOSING`, `${r.status} ${r.body?.code}`, '401 ACCOUNT_CLOSING');
        const l = await login(e);
        eq(`${e}: login with the right password -> 403 ACCOUNT_CLOSING`, `${l.status} ${l.body?.code}`, '403 ACCOUNT_CLOSING');
      }
      const msg = (await login('d@a.com')).body?.error ?? '';
      (/signed out/.test(msg) && /undo/.test(msg) && /\d{4}-\d{2}-\d{2}/.test(msg)) ? ok(`the message explains it and how to undo ("${msg.slice(0, 60)}…")`) : bad(`msg: ${msg}`);
      const wrong = await login('d@a.com', 'Wrong123!');
      eq('wrong password -> the usual 401, nothing about closing', `${wrong.status} ${wrong.body?.error}`, '401 invalid credentials');
      eq('other company unaffected', (await api('GET', '/users/me', tok['admin@b.com'])).status, 200);
      eq('school users unaffected', (await api('GET', '/users/me', tok['sa@s.com'])).status, 200);
      eq('nothing deleted (users / students / vans)', await snapshot(), before);

      console.log('\n--- undo ---');
      eq('undo without a token -> 400', (await api('DELETE', '/companies/me/closure')).status, 400);
      eq('undo with a wrong token -> 400', (await api('DELETE', `/companies/me/closure?token=${'0'.repeat(64)}`)).status, 400);
      await pool.query("UPDATE companies SET closure_purge_at = now() - interval '1 minute' WHERE id = $1", [A.id]);
      eq('undo after the purge date -> 400', (await api('DELETE', `/companies/me/closure?token=${raw}`)).status, 400);
      await pool.query("UPDATE companies SET closure_purge_at = closure_requested_at + interval '30 days' WHERE id = $1", [A.id]);
      const undo = await api('DELETE', `/companies/me/closure?token=${raw}`);
      eq('undo with the emailed token (no sign-in) -> 200', `${undo.status} ${undo.body?.company}`, `200 ${NAME}`);
      const after = await q('SELECT billing_status, closure_requested_at, closure_purge_at, closure_requested_by, closure_undo_token_hash FROM companies WHERE id = $1', [A.id]);
      eq('billing_status restored', after.billing_status, 'free');
      eq('every closure field cleared', [after.closure_requested_at, after.closure_purge_at, after.closure_requested_by, after.closure_undo_token_hash].every((v) => v === null), true);
      eq('the same link cannot be used twice', (await api('DELETE', `/companies/me/closure?token=${raw}`)).status, 400);
      eq('old sessions stay signed out after the undo', (await api('GET', '/auth/me', tok['d@a.com'])).status, 401);
      const back = await login('d@a.com');
      eq('people can sign in again', back.status, 200);
      eq('...and use the app', (await api('GET', '/users/me', back.body.token)).status, 200);

      console.log('\n--- asking twice ---');
      const tAdmin = (await login('admin@a.com')).body.token;
      eq('second request after an undo works -> 200', (await api('POST', '/companies/me/closure', tAdmin, { currentPassword: PW, confirmName: NAME })).status, 200);
      await pool.query("UPDATE companies SET billing_status = 'closing' WHERE id = $1", [A.id]);
      eq('nothing deleted at any point', await snapshot(), before);
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
