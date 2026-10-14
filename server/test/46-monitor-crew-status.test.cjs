// Monitor crew status (branch monitor-crew-status): the driver's "Picked up" / "No show" /
// "Dropped off" on the monitor stop, "Running late" from either side (the other one gets a push),
// the company admins' push right away on No show and 4 minutes after Running late if the monitor
// still isn't picked up (cancelled by Picked up), the admin banner feed, nothing blocking the run,
// and these records staying apart from the monitor's own check-in / check-out hours.
const PG_PORT = 5522;
const HTTP_PORT = 6047;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-46';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const push = require('../src/services/push.js');

const rec = createRecorder('46-monitor-crew-status');
const { ok, bad, eq } = rec;
const BASE = `http://localhost:${HTTP_PORT}`;
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
const notesFor = async (userId) => (await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at', [userId])).rows;
// "4 minutes later": move the waiting escalations to now, then run the same sweep the API runs.
async function fastForward() {
  await pool.query("UPDATE notifications SET send_at = now() - interval '1 second' WHERE status = 'scheduled'");
  return push.sendDueNotifications();
}

async function main() {
  const epg = await startEmbeddedPostgres('46-monitor-crew-status', PG_PORT);
  try {
    runMigrateUp();
    // No device tokens in this suite, so no push service is ever called; the records are checked.
    push.setTransportsForTest({ fetchFn: async () => { throw new Error('no network in tests'); } });
    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const B = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const user = (email, role, company, name) => ins(
      'INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id',
      [email, hash, name, role, company]
    );
    const admin1 = await user('admin1@a.example.test', 'company_admin', A.id, 'Ada Admin');
    const admin2 = await user('admin2@a.example.test', 'company_admin', A.id, 'Abe Admin');
    const adminB = await user('admin@b.example.test', 'company_admin', B.id, 'Bob Admin');
    const driver = await user('driver@a.example.test', 'driver', A.id, 'Dana Driver');
    const other = await user('other@a.example.test', 'driver', A.id, 'Otto Driver');
    const sam = await user('sam@a.example.test', 'monitor', A.id, 'Sam Monitor');
    const nia = await user('nia@a.example.test', 'monitor', A.id, 'Nia Monitor');
    const loose = await user('loose@a.example.test', 'monitor', A.id, 'Lou Unassigned');
    const student = await ins("INSERT INTO students(company_id,school_id,full_name,street_address) VALUES($1,$2,'Kid One','1 Elm St') RETURNING id", [A.id, S.id]);
    const van = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year,number) VALUES($1,'VAN-46','Ford','Transit',2022,'12') RETURNING id", [A.id]);
    await ins("INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,days_of_week) VALUES($1,$2,$3,$4,'2020-01-01','{1,2,3,4,5,6,7}') RETURNING id", [A.id, student.id, driver.id, van.id]);
    // Sam rides every run every day; Nia rides mornings only.
    await ins("INSERT INTO monitor_assignments(company_id,monitor_user_id,driver_user_id,days_of_week,shift_period) VALUES($1,$2,$3,'{1,2,3,4,5,6,7}','both') RETURNING id", [A.id, sam.id, driver.id]);
    await ins("INSERT INTO monitor_assignments(company_id,monitor_user_id,driver_user_id,days_of_week,shift_period) VALUES($1,$2,$3,'{1,2,3,4,5,6,7}','morning') RETURNING id", [A.id, nia.id, driver.id]);

    const app = createApp();
    const server = app.listen(HTTP_PORT);
    try {
      const tDriver = await login('driver@a.example.test');
      const tOther = await login('other@a.example.test');
      const tSam = await login('sam@a.example.test');
      const tAdmin1 = await login('admin1@a.example.test');
      const tAdminB = await login('admin@b.example.test');
      const press = (monitorId, shift, action, token = tDriver) => api('POST', `/schedule/monitors/${monitorId}/status`, token, { shift_period: shift, action });

      // The monitor checks in for their hours first; nothing below may touch this.
      const checkin = await api('POST', '/sessions/checkin', tSam, { shift_period: 'morning' });
      eq('monitor checks in for their hours -> 201', checkin.status, 201);
      const sessionsBefore = (await pool.query('SELECT id, check_in_at, check_out_at, duration_minutes FROM sessions WHERE user_id = $1 ORDER BY check_in_at', [sam.id])).rows;

      console.log('--- buttons: who can press what ---');
      eq('a bad action -> 400', (await press(sam.id, 'morning', 'teleported')).status, 400);
      eq('a bad shift -> 400', (await press(sam.id, 'night', 'picked_up')).status, 400);
      eq('a monitor not on this driver\'s run -> 404', (await press(loose.id, 'morning', 'picked_up')).status, 404);
      eq('Nia rides mornings only: afternoon -> 404', (await press(nia.id, 'afternoon', 'picked_up')).status, 404);
      eq('another driver can\'t press for Sam -> 404', (await press(sam.id, 'morning', 'picked_up', tOther)).status, 404);
      eq('a monitor can\'t use the driver buttons -> 403', (await press(sam.id, 'morning', 'picked_up', tSam)).status, 403);
      eq('an admin can\'t use the driver buttons -> 403', (await press(sam.id, 'morning', 'picked_up', tAdmin1)).status, 403);
      const before = (await api('GET', '/schedule/monitors', tDriver)).body;
      eq('before any press the stop is null', before.morning.find((m) => m.id === sam.id)?.stop, null);

      console.log('\n--- running late (driver) -> monitor push, admin escalation in 4 minutes ---');
      const late = await press(sam.id, 'morning', 'running_late');
      eq('driver presses Running late -> 200, status late', `${late.status} ${late.body?.status} ${late.body?.late_reported_by}`, '200 late driver');
      const escalateIn = (new Date(late.body.escalate_at) - new Date(late.body.late_reported_at)) / 60000;
      eq('the escalation is due 4 minutes after the press', Math.round(escalateIn), 4);
      const samNotes = await notesFor(sam.id);
      eq('the monitor gets a push: the driver is running late', `${samNotes.at(-1)?.title}|${samNotes.at(-1)?.status}`, 'Your driver is running late|sent');
      ok(/Dana Driver is running late and will be there shortly/.test(samNotes.at(-1)?.body) ? 'it names the driver' : `body: ${samNotes.at(-1)?.body}`);
      const waiting = (await pool.query("SELECT user_id, status FROM notifications WHERE category LIKE 'monitor_late:%' ORDER BY user_id")).rows;
      eq('each admin of the company has one escalation waiting (not sent yet)', waiting.map((w) => w.status).join(), 'scheduled,scheduled');
      eq('nothing for the other company\'s admin', (await notesFor(adminB.id)).length, 0);
      eq('admin bell not up yet (still inside the 4 minutes)', (await api('GET', '/notifications/unread-count', tAdmin1)).body.unread_count, 0);
      // Pressing again restarts the 4 minutes: still one waiting per admin.
      await press(sam.id, 'morning', 'running_late');
      eq('pressing again restarts it: still one waiting per admin', (await pool.query("SELECT count(*)::int AS n FROM notifications WHERE category LIKE 'monitor_late:%' AND status = 'scheduled'")).rows[0].n, 2);

      console.log('\n--- 4 minutes pass, still not picked up -> admins get the alert ---');
      await fastForward();
      eq('the restarted (first) escalation was cancelled, not sent', (await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND status = 'cancelled'", [admin1.id])).rows[0].n, 1);
      const alert = (await notesFor(admin1.id)).find((n) => n.data.kind === 'monitor_alert' && n.status === 'sent');
      eq('admin gets the escalation', `${alert?.status} ${alert?.data?.event}`, 'sent not_picked_up');
      eq('it says which driver, which monitor, which run', `${alert?.data?.driver_name}|${alert?.data?.monitor_name}|${alert?.data?.shift_period}|${alert?.data?.van}`, 'Dana Driver|Sam Monitor|morning|Van 12');
      ok(/still not picked up 4 minutes after Dana Driver said/.test(alert?.body) ? 'the text says what happened' : `body: ${alert?.body}`);
      eq('the second admin gets it too', (await notesFor(admin2.id)).filter((n) => n.status === 'sent').length, 1);
      eq('admin bell count goes up', (await api('GET', '/notifications/unread-count', tAdmin1)).body.unread_count, 1);
      const banner = (await api('GET', '/notifications?kind=monitor_alert&unread=1', tAdmin1)).body;
      eq('the banner feed lists the unread monitor alert', banner.items.map((i) => i.data.event).join(), 'not_picked_up');
      await api('POST', `/notifications/${banner.items[0].id}/read`, tAdmin1);
      eq('dismissing it (read) clears the banner feed', (await api('GET', '/notifications?kind=monitor_alert&unread=1', tAdmin1)).body.items.length, 0);

      console.log('\n--- picked up; the run goes on ---');
      const picked = await press(sam.id, 'morning', 'picked_up');
      eq('Picked up -> 200, status picked_up', `${picked.status} ${picked.body?.status}`, '200 picked_up');
      eq('Running late after pickup -> 409', (await press(sam.id, 'morning', 'running_late')).status, 409);
      eq('No show after pickup -> 409', (await press(sam.id, 'morning', 'no_show')).status, 409);
      eq('Picked up twice keeps the first time', (await press(sam.id, 'morning', 'picked_up')).body?.picked_up_at, picked.body?.picked_up_at);
      const dropped = await press(sam.id, 'morning', 'dropped_off');
      eq('Dropped off -> 200, status dropped_off', `${dropped.status} ${dropped.body?.status}`, '200 dropped_off');
      const listed = (await api('GET', '/schedule/monitors', tDriver)).body.morning.find((m) => m.id === sam.id);
      eq('the driver\'s monitor list shows the stop', listed?.stop?.status, 'dropped_off');

      console.log('\n--- running late (monitor), picked up within 4 minutes -> no admin alert ---');
      const mLate = await api('POST', '/monitor/running-late', tSam, { shift_period: 'afternoon' });
      eq('monitor presses Running late -> 200', `${mLate.status} ${mLate.body?.late_reported_by}`, '200 monitor');
      const driverNotes = await notesFor(driver.id);
      eq('the driver gets a push: the monitor is running late', driverNotes.at(-1)?.title, 'Your monitor is running late');
      ok(/Sam Monitor is running late and will be there shortly/.test(driverNotes.at(-1)?.body) ? 'it names the monitor' : `body: ${driverNotes.at(-1)?.body}`);
      eq('a driver can\'t use the monitor\'s button -> 403', (await api('POST', '/monitor/running-late', tDriver, { shift_period: 'afternoon' })).status, 403);
      eq('the monitor sees the stop on their screen', (await api('GET', '/monitor/me', tSam)).body.stops?.afternoon?.status, 'late');
      const adminSentBefore = (await notesFor(admin1.id)).filter((n) => n.status === 'sent').length;
      await press(sam.id, 'afternoon', 'picked_up');
      eq('Picked up cancels the waiting escalation', (await pool.query("SELECT count(*)::int AS n FROM notifications WHERE category LIKE 'monitor_late:%' AND status = 'scheduled'")).rows[0].n, 0);
      await fastForward();
      eq('after 4 minutes nothing reaches the admins', (await notesFor(admin1.id)).filter((n) => n.status === 'sent').length, adminSentBefore);

      console.log('\n--- no show -> admins right away; the run is not blocked ---');
      eq('driver marks Nia No show -> 200', (await press(nia.id, 'morning', 'no_show')).status, 200);
      const noShowAlert = (await notesFor(admin1.id)).find((n) => n.data.event === 'no_show');
      eq('admins get the No show push right away (no waiting)', `${noShowAlert?.status} ${noShowAlert?.data?.monitor_name}`, 'sent Nia Monitor');
      ok(/The run continues without the monitor/.test(noShowAlert?.body) ? 'it says the run continues' : `body: ${noShowAlert?.body}`);
      eq('both admins got it', (await notesFor(admin2.id)).filter((n) => n.data.event === 'no_show').length, 1);
      eq('No show twice sends no second alert', ((await press(nia.id, 'morning', 'no_show')).status === 200) && (await notesFor(admin1.id)).filter((n) => n.data.event === 'no_show').length, 1);
      eq('Running late after No show -> 409', (await press(nia.id, 'morning', 'running_late')).status, 409);
      eq('Dropped off without pickup after No show -> 409', (await press(nia.id, 'morning', 'dropped_off')).status, 409);
      eq('the monitor turns up after all: Picked up still works -> 200', (await press(nia.id, 'morning', 'picked_up')).body?.status, 'picked_up');
      const ninaRow = (await pool.query('SELECT no_show_at, picked_up_at FROM monitor_stops WHERE monitor_user_id = $1', [nia.id])).rows[0];
      ok(ninaRow.no_show_at && ninaRow.picked_up_at ? 'the No show stays on record next to the pickup' : 'no-show lost');
      // The driver carries on with the students: check in and log the trip as always.
      const dIn = await api('POST', '/sessions/checkin', tDriver, { shift_period: 'morning' });
      eq('driver checks in as normal', dIn.status, 201);
      eq('driver logs the student\'s pickup as normal (nothing blocked)', (await api('POST', '/trips', tDriver, { student_id: student.id, trip_type: 'pickup', shift_period: 'morning' })).status, 201);

      console.log('\n--- records ---');
      const events = (await pool.query(
        `SELECT e.event, u.role FROM monitor_stop_events e JOIN users u ON u.id = e.actor_user_id
          JOIN monitor_stops s ON s.id = e.monitor_stop_id WHERE s.monitor_user_id = $1 ORDER BY e.created_at`, [sam.id])).rows;
      eq('every press is recorded with who pressed it', events.map((e) => `${e.event}:${e.role}`).join(), 'running_late:driver,running_late:driver,picked_up:driver,dropped_off:driver,running_late:monitor,picked_up:driver');

      console.log('\n--- hours stay separate ---');
      const sessionsAfter = (await pool.query('SELECT id, check_in_at, check_out_at, duration_minutes FROM sessions WHERE user_id = $1 ORDER BY check_in_at', [sam.id])).rows;
      eq('no button created or changed a session (hours)', JSON.stringify(sessionsAfter), JSON.stringify(sessionsBefore));
      const out = await api('POST', `/sessions/${checkin.body.id}/checkout`, tSam);
      eq('the monitor still checks out for their hours as normal', `${out.status} ${Number.isInteger(out.body?.duration_minutes)}`, '200 true');
      const stopsBefore = (await pool.query('SELECT * FROM monitor_stops ORDER BY id')).rows;
      await api('POST', '/sessions/checkin', tSam, { shift_period: 'afternoon' });
      eq('checking in / out never touches the stop records', JSON.stringify((await pool.query('SELECT * FROM monitor_stops ORDER BY id')).rows), JSON.stringify(stopsBefore));
      eq('the driver\'s own hours are only their own check-in', (await pool.query('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1', [driver.id])).rows[0].n, 1);
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
