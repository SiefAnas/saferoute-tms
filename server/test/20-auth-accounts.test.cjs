// Auth for real users: generated temporary password + forced change at first login, forgot /
// reset password (hashed, single-use, time-limited tokens; same answer for unknown emails; rate
// limited), admin reset, and old sessions ending after a password change.
const PG_PORT = 5470;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-20';
process.env.NODE_ENV = 'test';
// Real limiters on, so the reset limit can be tested; login gets a high cap so it stays out of
// the way. Every forgot/reset call below counts toward the reset limit (max 20; 14 calls come before the spam test).
process.env.RATE_LIMIT_FORCE = '1';
process.env.RATE_LIMIT_LOGIN_MAX = '1000';
process.env.RATE_LIMIT_RESET_MAX = '20';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const mailer = require('../src/mail/mailer.js');

const rec = createRecorder('20-auth-accounts');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5950';
const PW = 'Secret123!';
const NEW_PW = 'MyOwnPass9!';
const RESET_PW = 'ResetPass7#';

async function api(method, p, token, body) {
  const opts = { method, headers: {} };
  if (token) opts.headers.authorization = `Bearer ${token}`;
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(BASE + p, opts);
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: data };
}
const login = (email, password) => api('POST', '/auth/login', null, { email, password });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tokenFromMail = () => {
  const m = mailer._sent().at(-1);
  return m ? /token=([0-9a-f]+)/.exec(m.text)?.[1] : undefined;
};

async function main() {
  const epg = await startEmbeddedPostgres('20-auth-accounts', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const B = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const user = (email, role, col, id) => ins(
      `INSERT INTO users(email,password_hash,full_name,role,${col},email_verified_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id`,
      [email, hash, email.split('@')[0], role, id]
    );
    await user('a1@a.com', 'company_admin', 'company_id', A.id);
    const a2 = await user('a2@a.com', 'company_admin', 'company_id', A.id);
    await user('b1@b.com', 'company_admin', 'company_id', B.id);
    await user('sa@s.com', 'school_admin', 'school_id', S.id);
    await user('inactive@a.com', 'driver', 'company_id', A.id).then((u) => pool.query('UPDATE users SET is_active = false WHERE id = $1', [u.id]));

    const server = createApp().listen(5950);
    try {
      const tA1 = (await login('a1@a.com', PW)).body.token;
      const tA2 = (await login('a2@a.com', PW)).body.token;
      const tB1 = (await login('b1@b.com', PW)).body.token;
      const tSA = (await login('sa@s.com', PW)).body.token;

      console.log('--- admin creates a driver: temporary password, shown once ---');
      const mk = await api('POST', '/users', tA1, { role: 'driver', fullName: 'New Driver', email: 'new@a.com', password: 'IgnoredPass1!' });
      eq('create driver with name + email only -> 201', mk.status, 201);
      const temp = mk.body?.temporary_password;
      /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(temp ?? '') ? ok(`temporary password returned once (${temp})`) : bad(`temp: ${temp}`);
      eq('must_change_password: true on the new account', mk.body?.must_change_password, true);
      eq('no password hash in the response', 'password_hash' in (mk.body ?? {}), false);
      eq('a password in the body is ignored (it does not log in)', (await login('new@a.com', 'IgnoredPass1!')).status, 401);
      eq('GET /users/:id never shows the temporary password', 'temporary_password' in (await api('GET', `/users/${mk.body.id}`, tA1)).body, false);
      const staff = await api('POST', '/users', tSA, { role: 'school_staff', fullName: 'New Staff', email: 'staff@s.com' });
      (staff.status === 201 && staff.body.temporary_password && staff.body.must_change_password) ? ok('school staff accounts get a temporary password too') : bad(`staff: ${JSON.stringify(staff.body)}`);

      console.log('\n--- first login: must set own password before using the app ---');
      const first = await login('new@a.com', temp);
      eq('login with the temporary password -> 200', first.status, 200);
      eq('login response says must_change_password: true', first.body?.user?.must_change_password, true);
      const tTemp = first.body.token;
      const blocked = await api('GET', '/schedule/today', tTemp);
      (blocked.status === 403 && blocked.body?.code === 'PASSWORD_CHANGE_REQUIRED') ? ok('any other endpoint -> 403 PASSWORD_CHANGE_REQUIRED') : bad(`blocked: ${blocked.status} ${JSON.stringify(blocked.body)}`);
      eq('GET /students is blocked too', (await api('GET', '/students', tTemp)).status, 403);
      const me = await api('GET', '/auth/me', tTemp);
      (me.status === 200 && me.body.user.mustChangePassword === true) ? ok('GET /auth/me still works and says mustChangePassword') : bad(`me: ${JSON.stringify(me.body)}`);
      eq('change-password with a wrong current password -> 400', (await api('POST', '/auth/change-password', tTemp, { currentPassword: 'Wrong1!xx', newPassword: NEW_PW })).status, 400);
      eq('change-password with a weak new password -> 400', (await api('POST', '/auth/change-password', tTemp, { currentPassword: temp, newPassword: 'short' })).status, 400);
      eq('change-password to the same password -> 400', (await api('POST', '/auth/change-password', tTemp, { currentPassword: temp, newPassword: temp })).status, 400);
      await sleep(1100); // the new token must be issued in a later second than the temp token
      const changed = await api('POST', '/auth/change-password', tTemp, { currentPassword: temp, newPassword: NEW_PW });
      (changed.status === 200 && changed.body.token && changed.body.user.must_change_password === false) ? ok('change-password -> 200 with a new token, must_change_password false') : bad(`changed: ${changed.status} ${JSON.stringify(changed.body)}`);
      const tNew = changed.body.token;
      eq('the old (temporary) session no longer works -> 401', (await api('GET', '/auth/me', tTemp)).status, 401);
      eq('the new token works on normal endpoints', (await api('GET', '/schedule/today', tNew)).status, 200);
      eq('the temporary password no longer logs in', (await login('new@a.com', temp)).status, 401);
      const relog = await login('new@a.com', NEW_PW);
      (relog.status === 200 && relog.body.user.must_change_password === false) ? ok('own password logs in, no change required') : bad(`relog: ${JSON.stringify(relog.body)}`);

      console.log('\n--- forgot password: same answer whether the email exists or not ---');
      mailer._reset();
      const known = await api('POST', '/auth/forgot-password', null, { email: 'NEW@a.com' });
      const unknown = await api('POST', '/auth/forgot-password', null, { email: 'nobody@a.com' });
      const inactive = await api('POST', '/auth/forgot-password', null, { email: 'inactive@a.com' });
      eq('known email -> 200 {ok:true}', JSON.stringify([known.status, known.body]), JSON.stringify([200, { ok: true }]));
      eq('unknown email -> the exact same response', JSON.stringify([unknown.status, unknown.body]), JSON.stringify([known.status, known.body]));
      eq('inactive account -> the exact same response', JSON.stringify([inactive.status, inactive.body]), JSON.stringify([known.status, known.body]));
      const sent = mailer._sent();
      (sent.length === 1 && sent[0].to === 'new@a.com' && /reset-password\?token=[0-9a-f]{64}/.test(sent[0].text))
        ? ok('exactly one email, to the real account, with a reset link')
        : bad(`sent: ${JSON.stringify(sent.map((m) => m.to))}`);
      const stored = (await pool.query('SELECT token_hash FROM password_reset_tokens')).rows.map((r) => r.token_hash);
      const raw1 = tokenFromMail();
      eq('only a hash is stored, never the raw token', stored.includes(raw1), false);
      eq('missing email -> 400', (await api('POST', '/auth/forgot-password', null, {})).status, 400);

      console.log('\n--- reset password: token rules ---');
      eq('wrong token -> 400', (await api('POST', '/auth/reset-password', null, { token: 'f'.repeat(64), newPassword: RESET_PW })).status, 400);
      eq('weak new password -> 400 (token not used up)', (await api('POST', '/auth/reset-password', null, { token: raw1, newPassword: 'weak' })).status, 400);
      await sleep(1100);
      eq('valid token -> 200', (await api('POST', '/auth/reset-password', null, { token: raw1, newPassword: RESET_PW })).status, 200);
      eq('same token again -> 400 (single use)', (await api('POST', '/auth/reset-password', null, { token: raw1, newPassword: 'Another1!x' })).status, 400);
      eq('sessions from before the reset -> 401', (await api('GET', '/auth/me', tNew)).status, 401);
      eq('old password no longer logs in', (await login('new@a.com', NEW_PW)).status, 401);
      eq('new password logs in', (await login('new@a.com', RESET_PW)).status, 200);

      mailer._reset();
      await api('POST', '/auth/forgot-password', null, { email: 'new@a.com' });
      const rawExpired = tokenFromMail();
      await pool.query("UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL");
      eq('expired token -> 400', (await api('POST', '/auth/reset-password', null, { token: rawExpired, newPassword: 'Expired1!x' })).status, 400);

      mailer._reset();
      await api('POST', '/auth/forgot-password', null, { email: 'new@a.com' });
      const rawOlder = tokenFromMail();
      await api('POST', '/auth/forgot-password', null, { email: 'new@a.com' });
      const rawNewest = tokenFromMail();
      eq('an older link stops working once a newer one is sent -> 400', (await api('POST', '/auth/reset-password', null, { token: rawOlder, newPassword: 'Older1!xyz' })).status, 400);
      eq('the newest link works -> 200', (await api('POST', '/auth/reset-password', null, { token: rawNewest, newPassword: 'Newest1!xyz' })).status, 200);

      console.log('\n--- admin reset (no email needed) ---');
      await sleep(1100);
      const drvTok = (await login('new@a.com', 'Newest1!xyz')).body.token;
      await sleep(1100);
      const reset = await api('POST', `/users/${mk.body.id}/reset-password`, tA1);
      (reset.status === 200 && reset.body.temporary_password && reset.body.user.must_change_password === true && !('password_hash' in reset.body.user))
        ? ok('creating admin resets -> 200, new temporary password, never the old one')
        : bad(`reset: ${reset.status} ${JSON.stringify(reset.body)}`);
      eq("the driver's current session is signed out -> 401", (await api('GET', '/auth/me', drvTok)).status, 401);
      const afterReset = await login('new@a.com', reset.body.temporary_password);
      eq('driver logs in with the new temporary password and must change it', afterReset.body?.user?.must_change_password, true);
      eq('same-company admin who did not create the account -> 403', (await api('POST', `/users/${mk.body.id}/reset-password`, tA2)).status, 403);
      eq('another company\'s admin -> 404', (await api('POST', `/users/${mk.body.id}/reset-password`, tB1)).status, 404);
      eq('a school admin -> 404 (not in their school)', (await api('POST', `/users/${mk.body.id}/reset-password`, tSA)).status, 404);
      eq('an admin resetting themselves -> 403', (await api('POST', '/users/' + (await api('GET', '/auth/me', tA1)).body.user.userId + '/reset-password', tA1)).status, 403);
      eq('an admin resetting another admin -> 403', (await api('POST', `/users/${a2.id}/reset-password`, tA1)).status, 403);

      // A second driver, active, tries to reset the first one.
      const mk2 = await api('POST', '/users', tA1, { role: 'driver', fullName: 'Driver Two', email: 'two@a.com' });
      const t2first = (await login('two@a.com', mk2.body.temporary_password)).body.token;
      const t2 = (await api('POST', '/auth/change-password', t2first, { currentPassword: mk2.body.temporary_password, newPassword: NEW_PW })).body.token;
      eq("a driver can't reset another driver's password -> 403", (await api('POST', `/users/${mk.body.id}/reset-password`, t2)).status, 403);
      eq("a driver can't reset through PATCH either -> 403", (await api('PATCH', `/users/${mk.body.id}`, t2, { password: 'Hacked1!x' })).status, 403);
      eq('PATCH with a password (even the creating admin) -> 400', (await api('PATCH', `/users/${mk.body.id}`, tA1, { password: 'Direct1!x' })).status, 400);

      console.log('\n--- rate limit on forgot/reset ---');
      const statuses = [];
      for (let i = 0; i < 12; i++) statuses.push((await api('POST', '/auth/forgot-password', null, { email: 'spam@a.com' })).status);
      const limited = statuses.indexOf(429);
      limited > 0 ? ok(`forgot-password is rate limited (429 after ${limited} more calls)`) : bad(`statuses: ${statuses.join(',')}`);
      const limitedReset = await api('POST', '/auth/reset-password', null, { token: 'a'.repeat(64), newPassword: RESET_PW });
      eq('reset-password shares the limit -> 429', limitedReset.status, 429);
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
