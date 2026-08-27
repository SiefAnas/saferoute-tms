// Payroll "Paid" cycle (task: add a Paid button that settles the current unpaid cycle) +
// the adjustments date-filtering bug fix found while building it. Driver work-time tracking
// already existed (sessions.check_in_at/check_out_at) — this only adds the "since when is
// this unpaid" marker (pay_rules.paid_through_at) and reuses the existing summary() math.
const PG_PORT = 5461;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-11';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('11-payroll-paid');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5100';
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
const login = async (email) => (await api('POST', '/auth/login', null, { email, password: PW })).body.token;

async function main() {
  const epg = await startEmbeddedPostgres('11-payroll-paid', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    await ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('admin@co.com',$1,'Admin','company_admin',$2,now()) RETURNING id",
      [hash, A.id]
    );
    const driver = await ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('driver@co.com',$1,'Driver','driver',$2,now()) RETURNING id",
      [hash, A.id]
    );
    const driver2 = await ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('driver2@co.com',$1,'Driver Two','driver',$2,now()) RETURNING id",
      [hash, A.id]
    );

    const app = createApp();
    const server = app.listen(5100);
    try {
      const admin = await login('admin@co.com');
      const drv = await login('driver@co.com');
      const drv2 = await login('driver2@co.com');

      eq('set hourly rate $20/hr -> 200', (await api('PUT', `/payroll/rules/${driver.id}`, admin, { rate_type: 'hourly', rate_cents: 2000 })).status, 200);

      // A session before any "paid" mark — 2 hours, several days ago.
      await pool.query(
        "INSERT INTO sessions(user_id,company_id,check_in_at,check_out_at,duration_minutes) VALUES($1,$2,now()-interval '5 days',now()-interval '5 days'+interval '2 hours',120)",
        [driver.id, A.id]
      );
      // An adjustment tied to that same old period.
      await api('POST', '/payroll/adjustments', admin, { driver_id: driver.id, amount_cents: 1000, note: 'old bonus', work_date: '2020-01-01' });

      console.log('--- unpaid-summary before any Paid mark ---');
      const before = await api('GET', `/payroll/unpaid-summary/${driver.id}`, admin);
      (before.status === 200 && before.body.paid_through_at === null && before.body.worked_minutes === 120 && before.body.total_pay_cents === 4000 + 1000)
        ? ok('unpaid-summary with no prior Paid mark = everything since the beginning (120 min, $40 base + $10 adj = $50)')
        : bad(`unpaid before: ${before.status} ${JSON.stringify(before.body)}`);

      console.log('\n--- adjustments date-filter bug fix ---');
      // Real bug found building this feature: summary()'s adjustments were never filtered by
      // from/to at all. Prove the fix: a `from` after the old adjustment's work_date must
      // exclude it from the summed total.
      const filtered = await api('GET', `/payroll/summary/${driver.id}?from=2025-01-01`, admin);
      (filtered.status === 200 && filtered.body.adjustments_cents === 0)
        ? ok('summary with from= after an old adjustment excludes it (bug fix confirmed)')
        : bad(`filtered summary: ${JSON.stringify(filtered.body)}`);
      const unfiltered = await api('GET', `/payroll/summary/${driver.id}`, admin);
      unfiltered.body.adjustments_cents === 1000
        ? ok('summary with no from/to still includes the old adjustment (unchanged behavior)')
        : bad(`unfiltered summary: ${JSON.stringify(unfiltered.body)}`);

      console.log('\n--- listing adjustments ---');
      const adjList = await api('GET', `/payroll/adjustments/${driver.id}`, admin);
      (adjList.status === 200 && adjList.body.length === 1 && adjList.body[0].note === 'old bonus')
        ? ok('company_admin lists a driver\'s adjustments') : bad(`adjustments list: ${JSON.stringify(adjList.body)}`);
      eq('driver reads own adjustments -> 200', (await api('GET', `/payroll/adjustments/${driver.id}`, drv)).status, 200);
      eq('driver reads another driver\'s adjustments -> 403', (await api('GET', `/payroll/adjustments/${driver.id}`, drv2)).status, 403);

      console.log('\n--- Mark Paid resets the cycle ---');
      eq('driver cannot mark themselves paid -> 403', (await api('POST', `/payroll/rules/${driver.id}/mark-paid`, drv)).status, 403);
      const paid = await api('POST', `/payroll/rules/${driver.id}/mark-paid`, admin);
      (paid.status === 200 && paid.body.paid_through_at) ? ok('company_admin marks driver paid -> 200, paid_through_at set') : bad(`mark-paid: ${paid.status} ${JSON.stringify(paid.body)}`);

      const afterPaid = await api('GET', `/payroll/unpaid-summary/${driver.id}`, admin);
      (afterPaid.status === 200 && afterPaid.body.worked_minutes === 0 && afterPaid.body.total_pay_cents === 0)
        ? ok('unpaid-summary resets to zero right after marking paid') : bad(`after paid: ${JSON.stringify(afterPaid.body)}`);

      // A new session logged AFTER the Paid mark should show up in the next unpaid cycle,
      // while the old (now-paid) session/adjustment must not bleed back in.
      await pool.query(
        "INSERT INTO sessions(user_id,company_id,check_in_at,check_out_at,duration_minutes) VALUES($1,$2,now(),now()+interval '1 hour',60)",
        [driver.id, A.id]
      );
      const afterNewShift = await api('GET', `/payroll/unpaid-summary/${driver.id}`, admin);
      (afterNewShift.status === 200 && afterNewShift.body.worked_minutes === 60 && afterNewShift.body.total_pay_cents === 2000)
        ? ok('a new shift after Paid shows up in the next unpaid cycle, old shift excluded')
        : bad(`after new shift: ${JSON.stringify(afterNewShift.body)}`);

      eq('unpaid-summary for a driver with no pay rule -> 404', (await api('GET', `/payroll/unpaid-summary/${driver2.id}`, admin)).status, 404);
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
