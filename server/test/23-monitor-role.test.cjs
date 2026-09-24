// Monitor role: the company admin creates a monitor (temporary password, forced change), assigns
// them to a driver with weekdays and a shift; the monitor checks in and out, sees the driver's name
// and phone and the van, never a student; their hours are paid from their own pay rule and show
// under the assigned driver; everything stays inside the company.
const PG_PORT = 5473;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-23';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('23-monitor-role');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5980';
const PW = 'Secret123!';
const NEW_PW = 'MonitorPass9!';

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

async function main() {
  const epg = await startEmbeddedPostgres('23-monitor-role', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const B = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const user = (email, role, company, phone = null) => ins(
      'INSERT INTO users(email,password_hash,full_name,role,company_id,phone,email_verified_at) VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING id',
      [email, hash, email.split('@')[0], role, company, phone]
    );
    await user('admin@a.example.test', 'company_admin', A.id);
    await user('admin@b.example.test', 'company_admin', B.id);
    const driver = await user('driver@a.example.test', 'driver', A.id, '555-0101');
    const driverB = await user('driver@b.example.test', 'driver', B.id);
    const monitorB = await user('monitor@b.example.test', 'monitor', B.id);
    const student = await ins("INSERT INTO students(company_id,school_id,full_name,street_address) VALUES($1,$2,'Maya Secret','12 Hidden St') RETURNING id", [A.id, S.id]);
    const van = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year,number,color) VALUES($1,'VAN-777','Ford','Transit',2022,'07','White') RETURNING id", [A.id]);
    await ins("INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,days_of_week) VALUES($1,$2,$3,$4,'2020-01-01','{1,2,3,4,5,6,7}') RETURNING id", [A.id, student.id, driver.id, van.id]);

    const app = createApp();
    const server = app.listen(5980);
    try {
      const tA = (await login('admin@a.example.test')).body.token;
      const tB = (await login('admin@b.example.test')).body.token;
      const tDriver = (await login('driver@a.example.test')).body.token;

      console.log('--- create ---');
      const mk = await api('POST', '/users', tA, { email: 'monitor@a.example.test', fullName: 'Mia Monitor', role: 'monitor' });
      eq('company admin creates a monitor with name + email only -> 201', mk.status, 201);
      (mk.body?.temporary_password && mk.body.must_change_password === true && mk.body.role === 'monitor')
        ? ok('the new monitor gets a temporary password and must change it') : bad(`create: ${JSON.stringify(mk.body)}`);
      const monitorId = mk.body.id;
      eq('a driver cannot create a monitor -> 403', (await api('POST', '/users', tDriver, { email: 'x@a.example.test', fullName: 'X', role: 'monitor' })).status, 403);

      console.log('\n--- first login ---');
      const first = await login('monitor@a.example.test', mk.body.temporary_password);
      eq('first login with the temporary password -> must change it', first.body?.user?.must_change_password, true);
      eq('before changing it, /monitor/me is refused -> 403', (await api('GET', '/monitor/me', first.body.token)).status, 403);
      const changed = await api('POST', '/auth/change-password', first.body.token, { currentPassword: mk.body.temporary_password, newPassword: NEW_PW });
      eq('monitor sets their own password -> 200', changed.status, 200);
      const tMon = changed.body.token;
      eq('login role is monitor', changed.body.user.role, 'monitor');

      console.log('\n--- assignment ---');
      const unassigned = await api('GET', '/monitor/me', tMon);
      (unassigned.status === 200 && unassigned.body.assignment === null && unassigned.body.driver === null && unassigned.body.van === null)
        ? ok('before an assignment, /monitor/me shows no driver and no van') : bad(`unassigned: ${JSON.stringify(unassigned.body)}`);
      eq('assign to a driver with bad weekdays -> 400', (await api('PUT', `/monitors/${monitorId}/assignment`, tA, { driver_user_id: driver.id, days_of_week: [0, 8] })).status, 400);
      eq('assign to a driver with a bad shift -> 400', (await api('PUT', `/monitors/${monitorId}/assignment`, tA, { driver_user_id: driver.id, shift_period: 'night' })).status, 400);
      eq('assign to another company\'s driver -> 404', (await api('PUT', `/monitors/${monitorId}/assignment`, tA, { driver_user_id: driverB.id })).status, 404);
      eq('assign a monitor as the driver -> 404 (must be a driver)', (await api('PUT', `/monitors/${monitorId}/assignment`, tA, { driver_user_id: monitorId })).status, 404);
      eq('company B admin assigns company A\'s monitor -> 404', (await api('PUT', `/monitors/${monitorId}/assignment`, tB, { driver_user_id: driverB.id })).status, 404);
      eq('company A admin assigns company B\'s monitor -> 404', (await api('PUT', `/monitors/${monitorB.id}/assignment`, tA, { driver_user_id: driver.id })).status, 404);
      const put = await api('PUT', `/monitors/${monitorId}/assignment`, tA, { driver_user_id: driver.id, days_of_week: [5, 1, 3], shift_period: 'morning' });
      eq('assign to own driver -> 200', put.status, 200);
      eq('assignment days come back sorted', JSON.stringify(put.body?.assignment?.days_of_week), '[1,3,5]');
      eq('assignment shift', put.body?.assignment?.shift_period, 'morning');
      eq('assignment driver name', put.body?.assignment?.driver_name, 'driver');
      const again = await api('PUT', `/monitors/${monitorId}/assignment`, tA, { driver_user_id: driver.id, days_of_week: [1, 2, 3, 4, 5], shift_period: 'both' });
      eq('saving again replaces the assignment (one per monitor)', `${again.body?.assignment?.shift_period} ${(await pool.query('SELECT count(*)::int AS n FROM monitor_assignments')).rows[0].n}`, 'both 1');

      console.log('\n--- what the monitor sees ---');
      const me = (await api('GET', '/monitor/me', tMon)).body;
      eq("driver's name", me.driver?.full_name, 'driver');
      eq("driver's phone (to call)", me.driver?.phone, '555-0101');
      eq('the van', `${me.van?.number} ${me.van?.license_plate} ${me.van?.color}`, '07 VAN-777 White');
      eq('weekdays and shift', `${JSON.stringify(me.assignment?.days_of_week)} ${me.assignment?.shift_period}`, '[1,2,3,4,5] both');
      const meJson = JSON.stringify(me);
      ok(!/Maya|Hidden|student/i.test(meJson) ? 'no student data in /monitor/me' : `student data leaked: ${meJson}`);
      for (const p of ['/students', `/students/${student.id}`, '/trips', '/assignments', '/vans', `/vans/${van.id}`, '/schedule/today', '/schedule/week', '/users', '/monitors', `/payroll/summary/${driver.id}`]) {
        eq(`monitor GET ${p} -> 403`, (await api('GET', p, tMon)).status, 403);
      }
      eq('a driver cannot open /monitor/me -> 403', (await api('GET', '/monitor/me', tDriver)).status, 403);

      console.log('\n--- check in / out ---');
      const cin = await api('POST', '/sessions/checkin', tMon, { shift_period: 'morning' });
      eq('monitor checks in -> 201', cin.status, 201);
      eq('checking in twice -> 409', (await api('POST', '/sessions/checkin', tMon, { shift_period: 'morning' })).status, 409);
      eq('/monitor/me shows the open shift', (await api('GET', '/monitor/me', tMon)).body.open_session?.id, cin.body.id);
      const list = (await api('GET', '/monitors', tA)).body;
      eq("admin's monitor list shows who's on shift", list.find((m) => m.id === monitorId)?.open_session?.shift_period, 'morning');
      eq('company B admin sees none of company A\'s monitors', (await api('GET', '/monitors', tB)).body.map((m) => m.id).join(), monitorB.id);
      eq('the driver cannot check the monitor out -> 404', (await api('POST', `/sessions/${cin.body.id}/checkout`, tDriver)).status, 404);
      const cout = await api('POST', `/sessions/${cin.body.id}/checkout`, tMon);
      (cout.status === 200 && cout.body.check_out_at && Number.isInteger(cout.body.duration_minutes)) ? ok('monitor checks out -> 200 with hours') : bad(`checkout: ${JSON.stringify(cout.body)}`);
      eq("after check-out the admin's list shows them off shift", (await api('GET', '/monitors', tA)).body.find((m) => m.id === monitorId)?.open_session, null);
      eq('/monitor/me lists today\'s shift', (await api('GET', '/monitor/me', tMon)).body.today_sessions.length, 1);

      console.log('\n--- payroll ---');
      // Two finished 90-minute shifts on a past day (fixed times, so the pay is exact).
      await pool.query(
        `INSERT INTO sessions(user_id,company_id,shift_period,check_in_at,check_out_at,duration_minutes) VALUES
           ($1,$2,'morning','2026-09-21 07:00+00','2026-09-21 08:30+00',90),
           ($1,$2,'afternoon','2026-09-21 14:00+00','2026-09-21 15:30+00',90)`,
        [monitorId, A.id]
      );
      const range = '?from=2026-09-21&to=2026-09-22';
      eq('no pay rule yet -> 404', (await api('GET', `/payroll/summary/${monitorId}${range}`, tA)).status, 404);
      eq('admin sets the monitor an hourly rate -> 200', (await api('PUT', `/payroll/rules/${monitorId}`, tA, { rate_type: 'hourly', rate_cents: 2000 })).status, 200);
      const hourly = (await api('GET', `/payroll/summary/${monitorId}${range}`, tA)).body;
      eq('hourly: 3 hours at $20 = $60', `${hourly.worked_minutes} ${hourly.total_pay_cents}`, '180 6000');
      await api('PUT', `/payroll/rules/${monitorId}`, tA, { rate_type: 'daily', rate_cents: 8000 });
      eq('daily: both shifts done = the full day rate', (await api('GET', `/payroll/summary/${monitorId}${range}`, tA)).body.base_pay_cents, 8000);
      const own = await api('GET', `/payroll/summary/${monitorId}${range}`, tMon);
      eq('the monitor reads their own pay -> 200', own.status, 200);
      eq('another company\'s admin reads it -> 404 (no rule in their company)', (await api('GET', `/payroll/summary/${monitorId}${range}`, tB)).status, 404);
      eq('company B admin sets a rate for company A\'s monitor -> 400', (await api('PUT', `/payroll/rules/${monitorId}`, tB, { rate_type: 'hourly', rate_cents: 1 })).status, 400);
      await api('PUT', `/payroll/rules/${driver.id}`, tA, { rate_type: 'hourly', rate_cents: 3000 });
      const driverPay = (await api('GET', `/payroll/summary/${driver.id}${range}`, tA)).body;
      eq("the monitor's hours don't count toward the driver's pay", driverPay.worked_minutes, 0);
      const monitors = (await api('GET', '/monitors', tA)).body;
      eq('payroll groups the monitor under the assigned driver (assignment.driver_user_id)', monitors.find((m) => m.id === monitorId)?.assignment?.driver_user_id, driver.id);
      const company = (await api('GET', `/payroll/summary/company${range}`, tA)).body;
      eq('company totals include the monitor', `${company.driver_count} ${company.monitor_count} ${company.total_minutes} ${company.total_pay_cents}`, '1 1 180 8000');

      console.log('\n--- reset + unassign ---');
      const reset = await api('POST', `/users/${monitorId}/reset-password`, tA);
      (reset.status === 200 && reset.body.temporary_password) ? ok('admin resets the monitor\'s password -> temporary password') : bad(`reset: ${JSON.stringify(reset.body)}`);
      eq('company B admin resets it -> 404', (await api('POST', `/users/${monitorId}/reset-password`, tB)).status, 404);
      eq('unassign -> 204', (await api('DELETE', `/monitors/${monitorId}/assignment`, tA)).status, 204);
      eq('unassign in another company -> 404', (await api('DELETE', `/monitors/${monitorId}/assignment`, tB)).status, 404);
      eq('after unassigning, the monitor list shows no driver', (await api('GET', '/monitors', tA)).body.find((m) => m.id === monitorId)?.assignment, null);
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
