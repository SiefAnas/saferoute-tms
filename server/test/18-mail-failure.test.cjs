// A failed notification email must never fail the request (bug found by the mobile session:
// no-show and skip-pickup saved their row, then answered 500 because the SMTP send threw).
// With the mailer forced to throw, every action still answers its normal success response,
// the row is saved, and the error log carries no email address. Emails go out after the response
// (a slow SMTP server made the live no-show hang for minutes), so a slow mailer doesn't slow the
// request either; `notified` lists who is being told.
const PG_PORT = 5468;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-18';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const mailer = require('../src/mail/mailer.js');

const rec = createRecorder('18-mail-failure');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5000';
const PW = 'Secret123!';
// Runs every day, so these checks don't depend on which weekday the tests run on
// (assignments default to Monday to Friday).
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

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

// Capture console.error so we can check what the failure log contains.
const errorLines = [];
const realError = console.error;
console.error = (...args) => { errorLines.push(args.join(' ')); };

async function main() {
  const epg = await startEmbeddedPostgres('18-mail-failure', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const addUser = (email, role, col, id) => ins(
      `INSERT INTO users(email,password_hash,full_name,role,${col},email_verified_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id`,
      [email, hash, email.split('@')[0], role, id]
    );
    await addUser('admin@co.com', 'company_admin', 'company_id', A.id);
    await addUser('sa@sch.com', 'school_admin', 'school_id', S.id);
    const driver = await addUser('driver@co.com', 'driver', 'company_id', A.id);
    const parent = await addUser('parent@co.com', 'parent', 'company_id', A.id);
    const van = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'AAA-1','Ford','Transit',2022) RETURNING id", [A.id]);

    const app = createApp();
    const server = app.listen(5000);
    try {
      const admin = await login('admin@co.com');
      const drv = await login('driver@co.com');
      const par = await login('parent@co.com');
      const sa = await login('sa@sch.com');

      const mkStudent = async (name) => (await api('POST', '/students', admin, {
        full_name: name, school_id: S.id, grade: '3', age: 8, parent_name: 'Pat Guardian', parent_phone: '555-1000',
        street_address: '5 Elm St', city: 'Boston', state: 'MA', zip_code: '02139', notes: 'None',
      })).body;
      const soon = (await pool.query("SELECT to_char(now() + interval '65 minutes', 'HH24:MI') AS t")).rows[0].t;

      const stuNoShow = await mkStudent('Kid NoShow');
      const asgNoShow = (await api('POST', '/assignments', admin, {
        student_id: stuNoShow.id, driver_user_id: driver.id, van_id: van.id, days_of_week: EVERY_DAY, start_date: '2020-01-01', shift_period: 'morning',
      })).body;
      const stuSkip = await mkStudent('Kid Skip');
      await api('POST', '/assignments', admin, {
        student_id: stuSkip.id, driver_user_id: driver.id, van_id: van.id, days_of_week: EVERY_DAY, start_date: '2020-01-01', pickup_time: soon,
      });
      await ins('INSERT INTO parent_students(parent_user_id,student_id,company_id) VALUES($1,$2,$3) RETURNING id', [parent.id, stuSkip.id, A.id]);
      const stuChange = await mkStudent('Kid Change');
      await api('POST', '/assignments', admin, {
        student_id: stuChange.id, driver_user_id: driver.id, van_id: van.id, days_of_week: EVERY_DAY, start_date: '2020-01-01', shift_period: 'afternoon',
      });

      await api('POST', '/sessions/checkin', drv, { shift_period: 'morning' });

      mailer._reset();
      mailer._failWith(Object.assign(new Error('550 mailbox unavailable for admin@co.com'), { responseCode: 550 }));

      console.log('--- driver no-show with the mailer throwing ---');
      const noShow = await api('POST', `/schedule/${asgNoShow.id}/no-show`, drv, { shift_period: 'morning' });
      eq('no-show -> 200 even though every send throws', noShow.status, 200);
      eq('no-show response reported: true', noShow.body?.reported, true);
      eq('no-show notified lists who is being told (company + school admin)', JSON.stringify([...(noShow.body?.notified ?? [])].sort()), JSON.stringify(['admin@co.com', 'sa@sch.com']));
      const noShowRows = (await pool.query('SELECT count(*)::int AS n FROM pickup_no_shows WHERE student_id = $1', [stuNoShow.id])).rows[0].n;
      eq('no-show row is saved', noShowRows, 1);

      console.log('\n--- parent skip-pickup with the mailer throwing ---');
      const skip = await api('POST', `/parent/students/${stuSkip.id}/skip-pickup`, par, {});
      eq('skip-pickup -> 200 even though every send throws', skip.status, 200);
      eq('skip-pickup response skipped: true', skip.body?.skipped, true);
      (skip.body?.notified ?? []).includes('driver@co.com') ? ok('skip-pickup notified includes the driver') : bad(`skip notified: ${JSON.stringify(skip.body?.notified)}`);
      const skipRows = (await pool.query('SELECT count(*)::int AS n FROM pickup_skips WHERE student_id = $1', [stuSkip.id])).rows[0].n;
      eq('skip row is saved', skipRows, 1);

      console.log('\n--- school schedule change with the mailer throwing ---');
      const change = await api('POST', `/schedule-changes/students/${stuChange.id}`, sa, { change_type: 'left_early' });
      eq('schedule change -> 201 even though every send throws', change.status, 201);
      const changeRows = (await pool.query('SELECT count(*)::int AS n FROM schedule_changes WHERE student_id = $1', [stuChange.id])).rows[0].n;
      eq('schedule change row is saved', changeRows, 1);

      console.log('\n--- the failure is logged without PII ---');
      await mailer._drained(); // the sends (and their failures) happen after the response
      const mailLogs = errorLines.filter((l) => l.includes('[mail] send failed'));
      mailLogs.length > 0 ? ok(`failures were logged (${mailLogs.length} lines)`) : bad('no [mail] failure log lines');
      mailLogs.some((l) => l.includes('event=no_show')) ? ok('log names the event type (no_show)') : bad('no event=no_show line');
      mailLogs.some((l) => l.includes('event=pickup_skip')) ? ok('log names the event type (pickup_skip)') : bad('no event=pickup_skip line');
      const leaks = mailLogs.filter((l) => /@|Kid |Pat Guardian/.test(l));
      leaks.length === 0 ? ok('no email address or student name in the failure log') : bad(`PII in log: ${leaks[0]}`);

      console.log('\n--- mailer working again: notifications go out normally ---');
      mailer._failWith(null);

      console.log('\n--- a slow mailer does not slow the request ---');
      mailer._slowBy(3000);
      const stuSlow = await mkStudent('Kid Slow');
      await api('POST', '/assignments', admin, {
        student_id: stuSlow.id, driver_user_id: driver.id, van_id: van.id, days_of_week: EVERY_DAY, start_date: '2020-01-01', shift_period: 'afternoon',
      });
      const t0 = Date.now();
      const slow = await api('POST', `/schedule-changes/students/${stuSlow.id}`, sa, { change_type: 'left_early' });
      const took = Date.now() - t0;
      (slow.status === 201 && took < 1500) ? ok(`answered in ${took} ms while each email takes 3 s`) : bad(`slow: ${slow.status} in ${took} ms`);
      await mailer._drained();
      mailer._slowBy(0);
      mailer._reset();
      const stuOk = await mkStudent('Kid Ok');
      await api('POST', '/assignments', admin, {
        student_id: stuOk.id, driver_user_id: driver.id, van_id: van.id, days_of_week: EVERY_DAY, start_date: '2020-01-01', shift_period: 'afternoon',
      });
      const change2 = await api('POST', `/schedule-changes/students/${stuOk.id}`, sa, { change_type: 'staying_later' });
      eq('schedule change with a working mailer -> 201', change2.status, 201);
      (change2.body?.notified ?? []).includes('admin@co.com')
        ? ok('notified lists the recipients that were sent to')
        : bad(`notified: ${JSON.stringify(change2.body?.notified)}`);
    } finally {
      server.close();
    }
  } finally {
    try { await pool.end(); } catch { /* already ended */ }
    await epg.stop();
  }
  console.error = realError;
  const { fail } = rec.summarize();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error = realError; console.error('FATAL:', e); process.exit(1); });
