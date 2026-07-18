// Hardening pass (BACKLOG): resendVerification hygiene, defense-in-depth deactivation of
// losing pending-claimants, rate limiting (force-enabled here only, tiny limits), and
// cross-cutting input validation. Each assertion maps to one specific backlog item.
const PG_PORT = 5456;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-07';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_FORCE = '1';
process.env.RATE_LIMIT_LOGIN_MAX = '3'; // deliberately tiny: this test trips it directly
process.env.RATE_LIMIT_SIGNUP_MAX = '20'; // headroom for ~6 legitimate signup calls earlier in this test
process.env.RATE_LIMIT_SEARCH_MAX = '3'; // deliberately tiny: this test trips it directly
process.env.RATE_LIMIT_VERIFY_MAX = '20'; // headroom for verify/resend calls earlier in this test

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const mailer = require('../src/mail/mailer.js');

const rec = createRecorder('07-hardening');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:4700';
const PW = 'Secret123!';

async function api(method, p, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + p, opts);
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: data };
}
const tokenFor = (email) => {
  const m = [...mailer._sent()].reverse().find((x) => x.to === email && /token:/.test(x.text));
  return m ? m.text.match(/token:\s*([a-f0-9]+)/)[1] : null;
};

async function main() {
  const epg = await startEmbeddedPostgres('07-hardening', PG_PORT);
  try {
    runMigrateUp();
    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);

    const app = createApp();
    const server = app.listen(4700);
    try {
      console.log('--- Input validation ---');
      eq(
        'signup with malformed email -> 400',
        (await api('POST', '/signup/company', { orgName: 'X', fullName: 'Y', email: 'not-an-email', password: PW })).status,
        400,
      );
      eq(
        'signup with short password -> 400',
        (await api('POST', '/signup/company', { orgName: 'X', fullName: 'Y', email: 'ok@x.com', password: 'short' })).status,
        400,
      );
      eq(
        'signup with oversized fullName -> 400',
        (await api('POST', '/signup/company', { orgName: 'X', fullName: 'x'.repeat(300), email: 'ok2@x.com', password: PW })).status,
        400,
      );

      console.log('\n--- resendVerification hygiene ---');
      const admin = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Seed Co','claimed',now()) RETURNING id");
      const adminUser = await ins(
        "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('seedadmin@x.com',$1,'Seed','company_admin',$2,now()) RETURNING id",
        [hash, admin.id],
      );
      const school = await ins(
        "INSERT INTO schools(name,address,claim_status,created_by_user_id) VALUES('Hygiene School','1 St','unclaimed',$1) RETURNING id",
        [adminUser.id],
      );
      const claim = await api('POST', '/signup/school', { claimId: school.id, fullName: 'Claimant', email: 'claimant@x.com', password: PW });
      eq('claim signup -> 201', claim.status, 201);
      const firstToken = tokenFor('claimant@x.com');
      firstToken ? ok('captured first verification token') : bad('no first token captured');

      const resend = await api('POST', '/auth/resend-verification', { email: 'claimant@x.com' });
      eq('resend -> 200 ok', resend.status, 200);
      const secondToken = tokenFor('claimant@x.com');
      secondToken && secondToken !== firstToken ? ok('resend issued a NEW, distinct token') : bad('resend did not issue a distinct new token');

      eq('OLD token (invalidated by resend) -> 400', (await api('POST', '/auth/verify-email', { token: firstToken })).status, 400);
      eq('NEW token -> 200 verified', (await api('POST', '/auth/verify-email', { token: secondToken })).status, 200);

      const sentBefore = mailer._sent().length;
      eq('resend after already verified -> 200 (no-op)', (await api('POST', '/auth/resend-verification', { email: 'claimant@x.com' })).status, 200);
      eq('no new mail sent for an already-verified user', mailer._sent().length, sentBefore);

      console.log('\n--- Defense-in-depth: losing claimant deactivated on takeover ---');
      const school2 = await ins(
        "INSERT INTO schools(name,address,claim_status,created_by_user_id) VALUES('Takeover School','1 St','unclaimed',$1) RETURNING id",
        [adminUser.id],
      );
      eq(
        'claimant A claims -> 201 pending',
        (await api('POST', '/signup/school', { claimId: school2.id, fullName: 'Loser', email: 'loser@x.com', password: PW })).status,
        201,
      );
      await pool.query("UPDATE schools SET claim_expires_at = now() - interval '1 hour' WHERE id = $1", [school2.id]);
      eq(
        'claimant B takes over expired pending claim -> 201',
        (await api('POST', '/signup/school', { claimId: school2.id, fullName: 'Winner', email: 'winner@x.com', password: PW })).status,
        201,
      );
      const winToken = tokenFor('winner@x.com');
      const verifyWin = await api('POST', '/auth/verify-email', { token: winToken });
      eq('B verifies -> claim finalized', verifyWin.body?.claimFinalized, true);

      const loserRow = (await pool.query("SELECT is_active FROM users WHERE email='loser@x.com'")).rows[0];
      loserRow.is_active === false
        ? ok('losing claimant A deactivated (is_active=false) on claim finalize')
        : bad(`loser is_active=${loserRow.is_active}, expected false`);
      eq(
        'losing claimant cannot even authenticate anymore -> 401',
        (await api('POST', '/auth/login', { email: 'loser@x.com', password: PW })).status,
        401,
      );

      console.log('\n--- Rate limiting (force-enabled, tiny limits for this test) ---');
      let hit429 = false;
      for (let i = 0; i < 6; i++) {
        const r = await api('POST', '/auth/login', { email: 'nobody@nowhere.test', password: 'wrong' });
        if (r.status === 429) { hit429 = true; break; }
      }
      hit429 ? ok('login rate limiter trips after repeated attempts -> 429') : bad('never got a 429 from the login limiter');

      let searchHit429 = false;
      for (let i = 0; i < 6; i++) {
        const r = await api('GET', '/signup/company/claimable?name=test');
        if (r.status === 429) { searchHit429 = true; break; }
      }
      searchHit429 ? ok('claimable-search rate limiter trips -> 429') : bad('never got a 429 from the search limiter');
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
