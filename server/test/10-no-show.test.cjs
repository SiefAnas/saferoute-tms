// Driver-reported no-show (real feature, added alongside the parent-role permission work):
// "when a driver arrives and no one shows up, they can hit a button marking the student
// Absent" — notifies the school and company admin. Also covers getTodaySchedule's new
// parent_skipped_today / no_show_reported_today fields.
const PG_PORT = 5460;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-10';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const mailer = require('../src/mail/mailer.js');

const rec = createRecorder('10-no-show');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5000';
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
  const epg = await startEmbeddedPostgres('10-no-show', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    await ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('admin@co.com',$1,'Admin','company_admin',$2,now()) RETURNING id",
      [hash, A.id]
    );
    await ins(
      "INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('sa@sch.com',$1,'School Admin','school_admin',$2,now()) RETURNING id",
      [hash, S.id]
    );
    const driver = await ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('driver@co.com',$1,'The Driver','driver',$2,now()) RETURNING id",
      [hash, A.id]
    );
    const driver2 = await ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('driver2@co.com',$1,'Other Driver','driver',$2,now()) RETURNING id",
      [hash, A.id]
    );
    const van = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'AAA-1','Ford','Transit',2022) RETURNING id", [A.id]);

    const app = createApp();
    const server = app.listen(5000);
    try {
      const admin = await login('admin@co.com');
      const drv = await login('driver@co.com');
      const drv2 = await login('driver2@co.com');

      const stu = (await api('POST', '/students', admin, {
        full_name: 'Kid One', school_id: S.id, grade: '3', age: 8, parent_name: 'Pat Guardian', parent_phone: '555-1000',
        street_address: '5 Elm St', city: 'Boston', state: 'MA', zip_code: '02139', notes: 'None',
      })).body;
      const asg = (await api('POST', '/assignments', admin, {
        student_id: stu.id, driver_user_id: driver.id, van_id: van.id, start_date: '2020-01-01',
      })).body;

      console.log('--- no-show requires an open shift ---');
      eq(
        'no-show before check-in -> 409',
        (await api('POST', `/schedule/${asg.id}/no-show`, drv)).status,
        409
      );

      await api('POST', '/sessions/checkin', drv, {});

      console.log('\n--- ownership ---');
      eq(
        'a different driver reporting a no-show on an assignment not theirs -> 404',
        (await api('POST', `/schedule/${asg.id}/no-show`, drv2)).status,
        404
      );
      eq(
        'non-driver role hitting the no-show route -> 403',
        (await api('POST', `/schedule/${asg.id}/no-show`, admin)).status,
        403
      );

      console.log('\n--- report + notify ---');
      mailer._reset();
      const report = await api('POST', `/schedule/${asg.id}/no-show`, drv);
      (report.status === 200 && report.body.reported === true)
        ? ok('driver reports a no-show -> 200')
        : bad(`report: ${report.status} ${JSON.stringify(report.body)}`);
      const sentTo = mailer._sent().map((m) => m.to).sort();
      JSON.stringify(sentTo) === JSON.stringify(['admin@co.com', 'sa@sch.com'])
        ? ok('notified exactly: company admin + school admin')
        : bad(`notified: ${JSON.stringify(sentTo)}`);

      eq(
        'reporting again same day -> 409 (double-submit guard)',
        (await api('POST', `/schedule/${asg.id}/no-show`, drv)).status,
        409
      );

      console.log("\n--- getTodaySchedule reflects the report ---");
      const today = await api('GET', '/schedule/today', drv);
      const item = (today.body ?? []).find((i) => i.assignment_id === asg.id);
      (item && item.no_show_reported_today === true)
        ? ok("today's schedule shows no_show_reported_today: true")
        : bad(`schedule item: ${JSON.stringify(item)}`);
      eq('parent_skipped_today is false (no parent skip happened)', item?.parent_skipped_today, false);
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
