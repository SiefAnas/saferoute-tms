// Dashboard redesign aggregates (2026-08-28): GET /dashboard/absent-today (today's real
// skip/no-show signals) and GET /payroll/summary/company (company-wide payroll snippet).
const PG_PORT = 5462;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-12';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('12-dashboard');
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
  const epg = await startEmbeddedPostgres('12-dashboard', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const admin = await ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('admin@co.com',$1,'Admin','company_admin',$2,now()) RETURNING id",
      [hash, A.id]
    );
    const driver1 = await ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('d1@co.com',$1,'Driver One','driver',$2,now()) RETURNING id",
      [hash, A.id]
    );
    const driver2 = await ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('d2@co.com',$1,'Driver Two','driver',$2,now()) RETURNING id",
      [hash, A.id]
    );
    const stu1 = await ins(
      "INSERT INTO students(company_id,school_id,full_name,grade,age,parent_name,parent_phone,street_address,city,state,zip_code) VALUES($1,$2,'Kid One','3',8,'P','555','1 St','City','MA','02139') RETURNING id",
      [A.id, S.id]
    );
    const stu2 = await ins(
      "INSERT INTO students(company_id,school_id,full_name,grade,age,parent_name,parent_phone,street_address,city,state,zip_code) VALUES($1,$2,'Kid Two','4',9,'P','555','1 St','City','MA','02139') RETURNING id",
      [A.id, S.id]
    );
    // Real skip/no-show signals for today.
    await pool.query(
      "INSERT INTO pickup_skips (company_id, student_id, parent_user_id, skip_date) VALUES ($1, $2, $3, CURRENT_DATE)",
      [A.id, stu1.id, driver1.id] // parent_user_id FK just needs a valid same-company user id for this direct-insert test
    );
    await pool.query(
      "INSERT INTO pickup_no_shows (company_id, student_id, driver_user_id, no_show_date) VALUES ($1, $2, $3, CURRENT_DATE)",
      [A.id, stu2.id, driver1.id]
    );

    // Pay rules + a completed session each, so companySummary has something real to sum.
    await pool.query('INSERT INTO pay_rules (driver_id, company_id, rate_type, rate_cents) VALUES ($1,$2,$3,$4)', [driver1.id, A.id, 'hourly', 2000]);
    await pool.query('INSERT INTO pay_rules (driver_id, company_id, rate_type, rate_cents) VALUES ($1,$2,$3,$4)', [driver2.id, A.id, 'daily', 15000]);
    await pool.query(
      "INSERT INTO sessions (user_id, company_id, check_in_at, check_out_at, duration_minutes) VALUES ($1,$2,now() - interval '2 hours', now(), 120)",
      [driver1.id, A.id]
    );
    await pool.query(
      "INSERT INTO sessions (user_id, company_id, check_in_at, check_out_at, duration_minutes) VALUES ($1,$2,now() - interval '3 hours', now(), 180)",
      [driver2.id, A.id]
    );

    const app = createApp();
    const server = app.listen(5100);
    try {
      const adminToken = await login('admin@co.com');
      const driverToken = await login('d1@co.com');

      console.log('--- Absent/late today ---');
      const absent = await api('GET', '/dashboard/absent-today', adminToken);
      const types = (absent.body ?? []).map((e) => e.type).sort();
      (absent.status === 200 && absent.body.length === 2 && JSON.stringify(types) === JSON.stringify(['driver_no_show', 'parent_skipped']))
        ? ok('absent-today returns both a skip and a no-show entry for today')
        : bad(`absent-today: ${absent.status} ${JSON.stringify(absent.body)}`);
      const skipEntry = absent.body.find((e) => e.type === 'parent_skipped');
      skipEntry?.student_name === 'Kid One' ? ok('skip entry resolves the real student name') : bad(`skip entry: ${JSON.stringify(skipEntry)}`);
      eq('driver GET /dashboard/absent-today -> 403 (company_admin only)', (await api('GET', '/dashboard/absent-today', driverToken)).status, 403);

      console.log('\n--- Company payroll summary ---');
      const today = (await pool.query('SELECT CURRENT_DATE AS d')).rows[0].d.toISOString().slice(0, 10);
      const tomorrow = (await pool.query("SELECT (CURRENT_DATE + 1) AS d")).rows[0].d.toISOString().slice(0, 10);
      const company = await api('GET', `/payroll/summary/company?from=${today}&to=${tomorrow}`, adminToken);
      // driver1: hourly $20 * 2h = $40.00; driver2: daily $150 * 1 day = $150.00 -> total $190.00, 300 minutes.
      (company.status === 200 && company.body.driver_count === 2 && company.body.total_minutes === 300 && company.body.total_pay_cents === 19000)
        ? ok('company payroll summary aggregates both drivers correctly')
        : bad(`company summary: ${company.status} ${JSON.stringify(company.body)}`);
      eq('driver GET /payroll/summary/company -> 403 (company_admin only)', (await api('GET', '/payroll/summary/company', driverToken)).status, 403);
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
