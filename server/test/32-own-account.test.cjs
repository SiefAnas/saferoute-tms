// Own account (branch account-settings): GET/PATCH /users/me for every role (own name, phone,
// address only), self-service email change (password check, "already taken", hashed token sent
// to the new address, resend, cancel), POST /auth/confirm-email-change (swap, sessions signed
// out), and the rate limit shared with the other verify endpoints.
const PG_PORT = 5490;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-32';
process.env.NODE_ENV = 'test';
// Real limiters on so the email-change limit can be tested; login gets a high cap.
process.env.RATE_LIMIT_FORCE = '1';
process.env.RATE_LIMIT_LOGIN_MAX = '1000';
process.env.RATE_LIMIT_VERIFY_MAX = '40';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const mailer = require('../src/mail/mailer.js');

const rec = createRecorder('32-own-account');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5991';
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
const lastToken = async () => {
  const m = (await mailer._drained()).at(-1);
  return { to: m?.to, token: m ? /confirm-email-change\?token=([0-9a-f]+)/.exec(m.text)?.[1] : undefined };
};

async function main() {
  const epg = await startEmbeddedPostgres('32-own-account', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const user = (email, role, col, id, extra = {}) => ins(
      `INSERT INTO users(email,password_hash,full_name,role,${col},email_verified_at,phone,address) VALUES($1,$2,$3,$4,$5,now(),$6,$7) RETURNING id`,
      [email, hash, email.split('@')[0], role, id, extra.phone ?? null, extra.address ?? null]
    );
    const ROLES = [
      ['admin@a.com', 'company_admin', 'company_id', A.id],
      ['driver@a.com', 'driver', 'company_id', A.id],
      ['monitor@a.com', 'monitor', 'company_id', A.id],
      ['parent@a.com', 'parent', 'company_id', A.id, { phone: '555-0100', address: '1 Main St, Boston, MA 02101' }],
      ['sadmin@s.com', 'school_admin', 'school_id', S.id],
      ['staff@s.com', 'school_staff', 'school_id', S.id],
    ];
    const ids = {};
    for (const [email, role, col, id, extra] of ROLES) ids[role] = (await user(email, role, col, id, extra)).id;

    const server = createApp().listen(5991);
    try {
      const tok = {};
      for (const [email, role] of ROLES) tok[role] = (await login(email)).body.token;

      console.log('--- GET/PATCH /users/me works for every role ---');
      for (const [email, role] of ROLES) {
        const me = await api('GET', '/users/me', tok[role]);
        (me.status === 200 && me.body.email === email && me.body.pending_email === null && !('password_hash' in me.body))
          ? ok(`${role}: GET /users/me -> own account, no hash`) : bad(`${role} me: ${me.status} ${JSON.stringify(me.body)}`);
        const upd = await api('PATCH', '/users/me', tok[role], { full_name: `  New ${role}  `, phone: '555-0199' });
        (upd.status === 200 && upd.body.full_name === `New ${role}` && upd.body.phone === '555-0199')
          ? ok(`${role}: PATCH name + phone -> 200 (trimmed)`) : bad(`${role} patch: ${upd.status} ${JSON.stringify(upd.body)}`);
      }
      const addr = await api('PATCH', '/users/me', tok.driver, { address: '9 Elm St, Boston, MA 02101' });
      eq('driver sets own address -> 200', addr.body?.address, '9 Elm St, Boston, MA 02101');

      console.log('\n--- never role, is_active, tenant or email ---');
      for (const body of [{ role: 'company_admin' }, { is_active: false }, { company_id: A.id }, { school_id: S.id }, { email: 'x@a.com' }, { full_name: 'Ok', role: 'company_admin' }, { password: 'Whatever1!' }]) {
        eq(`PATCH /users/me ${JSON.stringify(body)} -> 400`, (await api('PATCH', '/users/me', tok.driver, body)).status, 400);
      }
      const row = (await pool.query('SELECT role, is_active, company_id, full_name FROM users WHERE id = $1', [ids.driver])).rows[0];
      eq('driver row unchanged: still a driver, active, same company', `${row.role}/${row.is_active}/${row.company_id}`, `driver/true/${A.id}`);
      eq('the mixed body changed nothing (not even the allowed field)', row.full_name, 'New driver');
      eq('empty body -> 400', (await api('PATCH', '/users/me', tok.driver, {})).status, 400);
      eq('blank full_name -> 400', (await api('PATCH', '/users/me', tok.driver, { full_name: '   ' })).status, 400);
      eq('full_name over 200 chars -> 400 (same limit as the admin edit)', (await api('PATCH', '/users/me', tok.driver, { full_name: 'x'.repeat(201) })).status, 400);
      eq('phone over 30 chars -> 400', (await api('PATCH', '/users/me', tok.driver, { phone: '1'.repeat(31) })).status, 400);
      eq('number instead of text -> 400', (await api('PATCH', '/users/me', tok.driver, { phone: 5550100 })).status, 400);
      eq('parent cannot remove their phone -> 400', (await api('PATCH', '/users/me', tok.parent, { phone: '' })).status, 400);
      eq('parent cannot remove their address -> 400', (await api('PATCH', '/users/me', tok.parent, { address: null })).status, 400);
      eq('driver can clear their phone -> 200', (await api('PATCH', '/users/me', tok.driver, { phone: '' })).body?.phone, null);
      eq('no token -> 401', (await api('PATCH', '/users/me', null, { full_name: 'x' })).status, 401);
      eq('PATCH /users/:id is still admin only (driver -> 403)', (await api('PATCH', `/users/${ids.driver}`, tok.driver, { full_name: 'x' })).status, 403);

      console.log('\n--- email change: password, taken, same ---');
      mailer._reset();
      const wrongPw = await api('POST', '/users/me/email-change', tok.driver, { newEmail: 'driver.new@a.com', currentPassword: 'Wrong123!' });
      eq('wrong password -> 400', wrongPw.status, 400);
      eq('wrong password message', wrongPw.body?.error, 'current password is incorrect');
      const taken = await api('POST', '/users/me/email-change', tok.driver, { newEmail: 'MONITOR@a.com', currentPassword: PW });
      eq('email already used by another account (any case) -> 409', taken.status, 409);
      eq('taken message', taken.body?.error, 'email already registered');
      eq('own current email -> 400', (await api('POST', '/users/me/email-change', tok.driver, { newEmail: 'Driver@a.com', currentPassword: PW })).status, 400);
      eq('invalid email -> 400', (await api('POST', '/users/me/email-change', tok.driver, { newEmail: 'not-an-email', currentPassword: PW })).status, 400);
      eq('missing password -> 400', (await api('POST', '/users/me/email-change', tok.driver, { newEmail: 'driver.new@a.com' })).status, 400);
      eq('none of the refused requests stored anything', (await pool.query('SELECT pending_email FROM users WHERE id = $1', [ids.driver])).rows[0].pending_email, null);
      eq('none of them sent mail', (await mailer._drained()).length, 0);

      console.log('\n--- email change: request, resend, cancel ---');
      const req1 = await api('POST', '/users/me/email-change', tok.driver, { newEmail: ' driver.new@a.com ', currentPassword: PW });
      (req1.status === 200 && req1.body.pending_email === 'driver.new@a.com' && req1.body.email === 'driver@a.com' && req1.body.pending_email_sent_at)
        ? ok('request -> 200, pending_email set, email unchanged') : bad(`req1: ${req1.status} ${JSON.stringify(req1.body)}`);
      const m1 = await lastToken();
      eq('the link goes to the NEW address', m1.to, 'driver.new@a.com');
      m1.token ? ok('the email carries a confirm-email-change link') : bad('no token in the email');
      const stored = (await pool.query('SELECT pending_email_token_hash FROM users WHERE id = $1', [ids.driver])).rows[0].pending_email_token_hash;
      (stored && stored !== m1.token && stored.length === 64) ? ok('only a hash is stored, never the raw token') : bad(`stored: ${stored}`);
      eq('old email still logs in while pending', (await login('driver@a.com')).status, 200);
      eq('new email does not log in yet', (await login('driver.new@a.com')).status, 401);

      const resend = await api('POST', '/users/me/email-change/resend', tok.driver);
      eq('resend -> 200', resend.status, 200);
      const m2 = await lastToken();
      (m2.to === 'driver.new@a.com' && m2.token && m2.token !== m1.token) ? ok('resend mails a new link to the same new address') : bad(`m2: ${JSON.stringify(m2)}`);
      eq('the first link stopped working after the resend', (await api('POST', '/auth/confirm-email-change', null, { token: m1.token })).status, 400);

      const cancel = await api('DELETE', '/users/me/email-change', tok.driver);
      eq('cancel -> 200, nothing pending', cancel.body?.pending_email, null);
      eq('a cancelled link no longer works', (await api('POST', '/auth/confirm-email-change', null, { token: m2.token })).status, 400);
      eq('resend with nothing pending -> 409', (await api('POST', '/users/me/email-change/resend', tok.driver)).status, 409);

      console.log('\n--- confirm: swap, sessions signed out ---');
      await api('POST', '/users/me/email-change', tok.driver, { newEmail: 'driver.new@a.com', currentPassword: PW });
      const m3 = await lastToken();
      eq('confirm without a token -> 400', (await api('POST', '/auth/confirm-email-change', null, {})).status, 400);
      eq('confirm with a made-up token -> 400', (await api('POST', '/auth/confirm-email-change', null, { token: 'f'.repeat(64) })).status, 400);
      await sleep(1100); // sessions are compared to the second
      const confirmed = await api('POST', '/auth/confirm-email-change', null, { token: m3.token });
      (confirmed.status === 200 && confirmed.body.email === 'driver.new@a.com') ? ok('confirm -> 200 with the new email') : bad(`confirm: ${confirmed.status} ${JSON.stringify(confirmed.body)}`);
      const after = (await pool.query('SELECT email, pending_email, pending_email_token_hash, pending_email_sent_at FROM users WHERE id = $1', [ids.driver])).rows[0];
      eq('email swapped in', after.email, 'driver.new@a.com');
      eq('pending fields cleared', [after.pending_email, after.pending_email_token_hash, after.pending_email_sent_at].every((v) => v === null), true);
      eq('the old session is signed out -> 401', (await api('GET', '/users/me', tok.driver)).status, 401);
      eq('the old email no longer logs in', (await login('driver@a.com')).status, 401);
      const relog = await login('driver.new@a.com');
      eq('the new email logs in with the same password', relog.status, 200);
      tok.driver = relog.body.token;
      eq('the same link cannot be used twice', (await api('POST', '/auth/confirm-email-change', null, { token: m3.token })).status, 400);
      eq('other users keep their sessions', (await api('GET', '/users/me', tok.monitor)).status, 200);

      console.log('\n--- confirm: address taken in the meantime, expired link ---');
      await api('POST', '/users/me/email-change', tok.monitor, { newEmail: 'race@a.com', currentPassword: PW });
      const m4 = await lastToken();
      await user('race@a.com', 'driver', 'company_id', A.id);
      const race = await api('POST', '/auth/confirm-email-change', null, { token: m4.token });
      eq('address registered by someone else before confirming -> 409', race.status, 409);
      eq('monitor email unchanged', (await pool.query('SELECT email FROM users WHERE id = $1', [ids.monitor])).rows[0].email, 'monitor@a.com');
      eq('resend for an address now taken -> 409', (await api('POST', '/users/me/email-change/resend', tok.monitor)).status, 409);

      await api('POST', '/users/me/email-change', tok.monitor, { newEmail: 'late@a.com', currentPassword: PW });
      const m5 = await lastToken();
      await pool.query("UPDATE users SET pending_email_sent_at = now() - interval '25 hours' WHERE id = $1", [ids.monitor]);
      eq('a link older than 24 hours -> 400', (await api('POST', '/auth/confirm-email-change', null, { token: m5.token })).status, 400);

      await api('POST', '/users/me/email-change', tok.staff, { newEmail: 'gone@s.com', currentPassword: PW });
      const m6 = await lastToken();
      await pool.query('UPDATE users SET is_active = false WHERE id = $1', [ids.school_staff]);
      eq('a deactivated account cannot confirm -> 400', (await api('POST', '/auth/confirm-email-change', null, { token: m6.token })).status, 400);

      console.log('\n--- rate limited like the other verify endpoints ---');
      let limited = null;
      for (let i = 0; i < 45 && !limited; i++) {
        const r = await api('POST', '/users/me/email-change', tok.parent, { newEmail: `spam${i}@a.com`, currentPassword: 'Wrong123!' });
        if (r.status === 429) limited = i;
      }
      limited !== null ? ok(`email-change answers 429 after the verify limit (request ${limited + 1})`) : bad('never rate limited');
      eq('confirm-email-change shares the limit -> 429', (await api('POST', '/auth/confirm-email-change', null, { token: 'x' })).status, 429);
    } finally {
      server.close();
    }
  } catch (err) {
    bad(`unexpected error: ${err.stack}`);
  } finally {
    await pool.end();
    await epg.stop();
  }
  const { fail } = rec.summarize();
  process.exit(fail ? 1 : 0);
}

main();
