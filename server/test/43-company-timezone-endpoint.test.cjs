// Company timezone setting (branch company-timezone, task 5): GET/PATCH /companies/me timezone.
// company_admin only; a valid IANA zone is saved, an invalid one is refused with 400 and nothing
// changes; the next request already uses the new zone for "today".
const PG_PORT = 5487;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-43';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const clock = require('../src/time/clock.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('43-company-timezone-endpoint');
const { eq } = rec;
const BASE = 'http://localhost:5989';
const PW = 'Secret123!';

async function api(method, p, token, body) {
  const opts = { method, headers: { authorization: `Bearer ${token}` } };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(BASE + p, opts);
  return { status: r.status, body: await r.json() };
}
const login = (email) => fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) })
  .then((r) => r.json()).then((b) => b.token);

async function main() {
  const epg = await startEmbeddedPostgres('43-company-timezone-endpoint', PG_PORT);
  try {
    runMigrateUp();
    const hash = await hashPassword(PW);
    const q = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await q("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const S = await q("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School','claimed',now()) RETURNING id");
    const user = (email, role, col, id) => q(`INSERT INTO users(email,password_hash,full_name,role,${col},email_verified_at) VALUES($1,$2,$1,$3,$4,now()) RETURNING id`, [email, hash, role, id]);
    await user('admin@a.test', 'company_admin', 'company_id', A.id);
    const driver = await user('driver@a.test', 'driver', 'company_id', A.id);
    await user('sadmin@s.test', 'school_admin', 'school_id', S.id);
    const van = await q("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'V-1','Ford','Transit',2022) RETURNING id", [A.id]);
    for (const day of ['2026-10-14', '2026-10-15']) {
      const st = await q("INSERT INTO students(company_id,school_id,full_name,grade) VALUES($1,$2,$3,'3') RETURNING id", [A.id, S.id, `Day ${day}`]);
      await q("INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,end_date,days_of_week) VALUES($1,$2,$3,$4,$5,$5,'{1,2,3,4,5,6,7}')", [A.id, st.id, driver.id, van.id, day]);
    }

    const server = createApp().listen(5989);
    try {
      const tA = await login('admin@a.test');
      const tD = await login('driver@a.test');
      const tS = await login('sadmin@s.test');

      console.log('--- read ---');
      eq('GET /companies/me includes the timezone (default America/New_York)', (await api('GET', '/companies/me', tA)).body.timezone, 'America/New_York');

      console.log('\n--- refused, nothing changes ---');
      for (const bad of ['Mars/Olympus', 'EST', '+05:00', 'america/new york', '', 'UTC; DROP TABLE companies', 42, null]) {
        const r = await api('PATCH', '/companies/me', tA, { timezone: bad });
        eq(`timezone ${JSON.stringify(bad)} -> 400`, r.status, 400);
      }
      eq('the error says what is expected', (await api('PATCH', '/companies/me', tA, { timezone: 'Mars/Olympus' })).body.error, 'timezone must be an IANA time zone name, like America/Chicago');
      eq('stored timezone unchanged after the refusals', (await q('SELECT timezone FROM companies WHERE id = $1', [A.id])).timezone, 'America/New_York');
      eq('driver -> 403', (await api('PATCH', '/companies/me', tD, { timezone: 'America/Chicago' })).status, 403);
      eq('school admin -> 403', (await api('PATCH', '/companies/me', tS, { timezone: 'America/Chicago' })).status, 403);

      console.log('\n--- saved ---');
      clock._pin('2026-10-15T05:30:00Z'); // New York Oct 15 01:30 | Los Angeles Oct 14 22:30
      const names = async () => (await api('GET', '/schedule/today', tD)).body.map((i) => i.student.name).join(',');
      eq('before: the driver (New York) is on Oct 15', await names(), 'Day 2026-10-15');
      const ok = await api('PATCH', '/companies/me', tA, { timezone: 'America/Los_Angeles' });
      eq('valid zone -> 200 with the new timezone', `${ok.status} ${ok.body.timezone}`, '200 America/Los_Angeles');
      eq('stored', (await q('SELECT timezone FROM companies WHERE id = $1', [A.id])).timezone, 'America/Los_Angeles');
      eq('the very next request uses it: the driver is now on Oct 14', await names(), 'Day 2026-10-14');
      eq('/auth/me shows the company zone', (await api('GET', '/auth/me', tD)).body.user.companyTimeZone, 'America/Los_Angeles');
      for (const zone of ['UTC', 'Asia/Kolkata', 'Asia/Calcutta', 'America/Argentina/Buenos_Aires']) {
        eq(`also accepted: ${zone}`, (await api('PATCH', '/companies/me', tA, { timezone: zone })).status, 200);
      }
      eq('other fields can still be saved without a timezone', (await api('PATCH', '/companies/me', tA, { phone: '555-0100' })).status, 200);
      clock._pin(null);
    } finally {
      server.close();
    }
  } finally {
    clock._pin(null);
    try { await pool.end(); } catch { /* already ended */ }
    await epg.stop();
  }
  const { fail } = rec.summarize();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
