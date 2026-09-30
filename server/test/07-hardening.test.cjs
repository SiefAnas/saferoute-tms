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
const tokenFor = async (email) => {
  const m = [...(await mailer._drained())].reverse().find((x) => x.to === email && /token:/.test(x.text));
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
      console.log('--- Response headers ---');
      const headerCheck = await fetch(BASE + '/health');
      eq('X-Powered-By header is not sent (app.disable(\'x-powered-by\'))', headerCheck.headers.has('x-powered-by'), false);

      console.log('\n--- Input validation ---');
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
      // Self-claim is refused since the 2026-09-30 fix, so the only pending claimants left are ones
      // started before it: seed that state directly (placeholder pending_claim, unverified user).
      eq('self-claim signup -> 403', (await api('POST', '/signup/school', { claimId: school.id, fullName: 'Claimant', email: 'claimant@x.com', password: PW })).status, 403);
      await pool.query("UPDATE schools SET claim_status='pending_claim', claim_expires_at=now() + interval '1 day' WHERE id=$1", [school.id]);
      await ins("INSERT INTO users(email,password_hash,full_name,role,school_id) VALUES('claimant@x.com',$1,'Claimant','school_admin',$2) RETURNING id", [hash, school.id]);
      eq('resend for a leftover pending claimant -> 200', (await api('POST', '/auth/resend-verification', { email: 'claimant@x.com' })).status, 200);
      const firstToken = await tokenFor('claimant@x.com');
      firstToken ? ok('captured first verification token') : bad('no first token captured');

      const resend = await api('POST', '/auth/resend-verification', { email: 'claimant@x.com' });
      eq('resend -> 200 ok', resend.status, 200);
      const secondToken = await tokenFor('claimant@x.com');
      secondToken && secondToken !== firstToken ? ok('resend issued a NEW, distinct token') : bad('resend did not issue a distinct new token');

      eq('OLD token (invalidated by resend) -> 400', (await api('POST', '/auth/verify-email', { token: firstToken })).status, 400);
      eq('NEW token -> 200 verified', (await api('POST', '/auth/verify-email', { token: secondToken })).status, 200);

      const sentBefore = (await mailer._drained()).length;
      eq('resend after already verified -> 200 (no-op)', (await api('POST', '/auth/resend-verification', { email: 'claimant@x.com' })).status, 200);
      eq('no new mail sent for an already-verified user', (await mailer._drained()).length, sentBefore);

      console.log('\n--- Verifying never finalizes a claim ---');
      eq('the verified leftover claimant still cannot operate (school not claimed)',
        (await pool.query("SELECT claim_status FROM schools WHERE id=$1", [school.id])).rows[0].claim_status, 'pending_claim');
      const school2 = await ins(
        "INSERT INTO schools(name,address,claim_status,created_by_user_id) VALUES('Takeover School','1 St','unclaimed',$1) RETURNING id",
        [adminUser.id],
      );
      eq('self-claim of another placeholder -> 403',
        (await api('POST', '/signup/school', { claimId: school2.id, fullName: 'Winner', email: 'winner@x.com', password: PW })).status, 403);
      eq('and it created no account', (await pool.query("SELECT count(*)::int AS n FROM users WHERE email='winner@x.com'")).rows[0].n, 0);

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
