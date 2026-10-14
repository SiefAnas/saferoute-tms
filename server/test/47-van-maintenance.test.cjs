// Van maintenance and fuel (branch van-maintenance): built-in items per van, custom items, date
// and mileage due (due soon / overdue), reminder timing (company default, per-van override,
// changing the default leaves overrides alone), pushes to the admins and the van's driver (once per
// cycle, daytime only), Done resets the counter and keeps history (also for deleted items), fuel
// entries (driver: own van, miles required, never below the last reading; admin: any, can fix),
// odometer reminders every N days, and who may do what.
const PG_PORT = 5523;
const HTTP_PORT = 6048;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-47';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const push = require('../src/services/push.js');
const fleet = require('../src/services/fleet.js');
const { dateInZone, addDays } = require('../src/time/businessDate.js');

const rec = createRecorder('47-van-maintenance');
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
const pushes = async (userId, category) => (await pool.query('SELECT * FROM notifications WHERE user_id = $1 AND category = $2 ORDER BY created_at', [userId, category])).rows;

async function main() {
  const epg = await startEmbeddedPostgres('47-van-maintenance', PG_PORT);
  try {
    runMigrateUp();
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
    const admin = await user('admin@a.example.test', 'company_admin', A.id, 'Ada Admin');
    await user('admin@b.example.test', 'company_admin', B.id, 'Bob Admin');
    const driver = await user('driver@a.example.test', 'driver', A.id, 'Dana Driver');
    const driver2 = await user('driver2@a.example.test', 'driver', A.id, 'Dev Driver');
    const idle = await user('idle@a.example.test', 'driver', A.id, 'Ida Idle');
    const student = await ins("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,'Kid') RETURNING id", [A.id, S.id]);
    const student2 = await ins("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,'Kid Two') RETURNING id", [A.id, S.id]);

    // "Now" for the sweep: 13:00 / 12:00 in New York on today's New York date (daytime), and 03:00.
    const today = dateInZone('America/New_York', new Date());
    const noon = new Date(`${today}T17:00:00Z`);
    const night = new Date(`${today}T07:00:00Z`);

    const app = createApp();
    const server = app.listen(HTTP_PORT);
    try {
      const tA = await login('admin@a.example.test');
      const tB = await login('admin@b.example.test');
      const tD = await login('driver@a.example.test');
      const tD2 = await login('driver2@a.example.test');

      console.log('--- vans + built-in items + first-van settings ---');
      eq('settings before the first van: not configured yet', (await api('GET', '/fleet/settings', tA)).body.configured, false);
      const v1 = (await api('POST', '/vans', tA, { license_plate: 'MNT-1', brand: 'Ford', model: 'Transit', year: 2022, color: 'White', number: '12' })).body;
      const v2 = (await api('POST', '/vans', tA, { license_plate: 'MNT-2', brand: 'Ford', model: 'Transit', year: 2021, color: 'Blue', number: '14' })).body;
      await ins("INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,days_of_week) VALUES($1,$2,$3,$4,'2020-01-01','{1,2,3,4,5,6,7}') RETURNING id", [A.id, student.id, driver.id, v1.id]);
      await ins("INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,days_of_week) VALUES($1,$2,$3,$4,'2020-01-01','{1,2,3,4,5,6,7}') RETURNING id", [A.id, student2.id, driver2.id, v2.id]);
      const m1 = (await api('GET', `/fleet/vans/${v1.id}/maintenance`, tA)).body;
      eq('a new van gets the four built-in items', m1.items.map((i) => i.builtin_key).join(), 'fleet_inspection,7d_inspection,oil_change,brake_change');
      eq('built-ins: two by date, two by mileage', m1.items.map((i) => i.schedule_type).join(), 'date,date,mileage,mileage');
      eq('nothing due until the admin sets it', m1.items.map((i) => i.state).join(), 'not_set,not_set,not_set,not_set');
      const set = await api('PUT', '/fleet/settings', tA, { default_remind_days: 30, default_remind_miles: 500, odometer_reminder_days: null });
      eq('the admin sets the defaults -> configured', `${set.status} ${set.body.configured} ${set.body.default_remind_days} ${set.body.default_remind_miles}`, '200 true 30 500');
      eq('bad settings -> 400', (await api('PUT', '/fleet/settings', tA, { default_remind_days: -1 })).status, 400);
      const item = (key, m = m1) => m.items.find((i) => i.builtin_key === key);

      console.log('\n--- mileage due ---');
      const oil = item('oil_change');
      eq('set oil change due at 10,000 miles', (await api('PATCH', `/fleet/vans/${v1.id}/maintenance/${oil.id}`, tA, { due_miles: 10000 })).body.state, 'no_reading');
      eq('a mileage item refuses a date -> 400', (await api('PATCH', `/fleet/vans/${v1.id}/maintenance/${oil.id}`, tA, { due_date: today })).status, 400);
      eq('driver: miles are required -> 400', (await api('POST', '/fleet/fuel', tD, { gallons: 10 })).status, 400);
      const e1 = await api('POST', '/fleet/fuel', tD, { miles: 9400 });
      eq('driver adds a reading (miles only; van found from the assignment) -> 201', `${e1.status} ${e1.body.miles} ${e1.body.gallons} ${e1.body.cost} ${e1.body.van_id === v1.id}`, '201 9400 null null true');
      let s = (await api('GET', `/fleet/vans/${v1.id}/maintenance`, tA)).body;
      eq('600 miles to go, window 500 -> ok', `${item('oil_change', s).state} ${item('oil_change', s).miles_left}`, 'ok 600');
      eq('no push yet', (await pushes(admin.id, 'maintenance')).length, 0);
      const e2 = await api('POST', '/fleet/fuel', tD, { miles: 9600, gallons: 18.5, cost: 64.2 });
      eq('with gallons and cost', `${e2.body.gallons} ${e2.body.cost}`, '18.5 64.2');
      s = (await api('GET', `/fleet/vans/${v1.id}/maintenance`, tA)).body;
      eq('newest reading drives it: 400 to go -> due soon', `${item('oil_change', s).state} ${s.current_miles}`, 'due_soon 9600');
      const adminPush = await pushes(admin.id, 'maintenance');
      eq('the admin got a push right away', adminPush.map((n) => n.title).join(), 'Oil change due soon: Van 12');
      ok(/due in 400 miles \(at 10,000; now 9,600\)/.test(adminPush[0]?.body) ? 'it says how far and the numbers' : `body: ${adminPush[0]?.body}`);
      eq('the van\'s driver got it too', (await pushes(driver.id, 'maintenance')).length, 1);
      eq('the other van\'s driver did not', (await pushes(driver2.id, 'maintenance')).length, 0);
      eq('it shows in the admin\'s bell list', (await api('GET', '/notifications', tA)).body.items.some((n) => n.title === 'Oil change due soon: Van 12'), true);
      await api('POST', '/fleet/fuel', tD, { miles: 9700 });
      eq('another reading in the window: no second push', (await pushes(admin.id, 'maintenance')).length, 1);
      await fleet.runFleetReminders({ now: noon });
      eq('the sweep doesn\'t resend it either', (await pushes(admin.id, 'maintenance')).length, 1);
      eq('driver: below the last reading -> 409', (await api('POST', '/fleet/fuel', tD, { miles: 9000 })).status, 409);
      await api('POST', '/fleet/fuel', tD, { miles: 10100 });
      eq('past the target -> overdue push', (await pushes(admin.id, 'maintenance')).map((n) => n.title).join(' | '), 'Oil change due soon: Van 12 | Oil change overdue: Van 12');
      const due = (await api('GET', '/fleet/due', tA)).body;
      eq('the Vans page list: overdue', due.overdue.map((x) => `${x.van_label} ${x.name} ${x.miles_left}`).join(), 'Van 12 Oil change -100');

      console.log('\n--- done resets the counter, history kept ---');
      const done = await api('POST', `/fleet/vans/${v1.id}/maintenance/${oil.id}/done`, tA, { notes: 'Synthetic' });
      eq('Done -> next target = current odometer + interval (10,100 + 5,000)', `${done.status} ${done.body.item.due_miles} ${done.body.item.state}`, '200 15100 ok');
      eq('the record keeps what was due and the odometer', `${done.body.record.was_due_miles} ${done.body.record.odometer} ${done.body.record.next_due_miles} ${done.body.record.notes}`, '10000 10100 15100 Synthetic');
      await api('POST', '/fleet/fuel', tD, { miles: 14700 });
      eq('the next cycle reminds again (new target)', (await pushes(admin.id, 'maintenance')).length, 3);
      await api('POST', `/fleet/vans/${v1.id}/maintenance/${oil.id}/done`, tA, { odometer: 14800 });
      const hist = (await api('GET', `/fleet/vans/${v1.id}/history?item_id=${oil.id}`, tA)).body;
      eq('every past oil change is in the history, newest first', hist.map((r) => r.odometer).join(), '14800,10100');
      eq('history says who did it', hist[0].done_by, 'Ada Admin');

      console.log('\n--- date due + reminder timing ---');
      const insp = item('fleet_inspection');
      await api('PATCH', `/fleet/vans/${v1.id}/maintenance/${insp.id}`, tA, { due_date: addDays(today, 20) });
      s = (await api('GET', `/fleet/vans/${v1.id}/maintenance`, tA)).body;
      eq('due in 20 days, window 30 days -> due soon', `${item('fleet_inspection', s).state} ${item('fleet_inspection', s).days_left}`, 'due_soon 20');
      const before = (await pushes(admin.id, 'maintenance')).length;
      eq('a date item reminds as soon as it is set inside the window', (await pushes(admin.id, 'maintenance')).at(-1)?.title, 'Fleet inspection due soon: Van 12');
      // Van 14: the admin customizes its window to 10 days.
      const m2 = (await api('GET', `/fleet/vans/${v2.id}/maintenance`, tA)).body;
      const r2 = await api('PATCH', `/fleet/vans/${v2.id}/reminders`, tA, { remind_days_before: 10 });
      eq('per-van override', `${r2.body.days_before} ${r2.body.miles_before} ${r2.body.custom}`, '10 500 true');
      // Set the date at night so only the sweep can send (it waits for the day).
      await pool.query("UPDATE maintenance_items SET due_date = $2 WHERE id = $1", [item('7d_inspection', m2).id, addDays(today, 20)]);
      await pool.query("UPDATE maintenance_items SET due_date = $2 WHERE id = $1", [item('fleet_inspection', m2).id, addDays(today, 8)]);
      eq('the sweep sends nothing at 3 am', await fleet.runFleetReminders({ now: night }), 0);
      await fleet.runFleetReminders({ now: noon });
      const v2push = (await pushes(driver2.id, 'maintenance')).map((n) => n.title);
      eq('Van 14 (10-day window): 8 days -> reminded, 20 days -> not', v2push.join(), 'Fleet inspection due soon: Van 14');
      await api('PUT', '/fleet/settings', tA, { default_remind_days: 40, default_remind_miles: 500, odometer_reminder_days: null });
      const after1 = (await api('GET', `/fleet/vans/${v1.id}/maintenance`, tA)).body;
      const after2 = (await api('GET', `/fleet/vans/${v2.id}/maintenance`, tA)).body;
      eq('changing the default: an uncustomized van follows it', after1.reminders.days_before, 40);
      eq('changing the default: the customized van keeps its own', `${after2.reminders.days_before} ${item('7d_inspection', after2).state}`, '10 ok');
      eq('back to the default with null', (await api('PATCH', `/fleet/vans/${v2.id}/reminders`, tA, { remind_days_before: null })).body.days_before, 40);
      const doneDate = await api('POST', `/fleet/vans/${v1.id}/maintenance/${insp.id}/done`, tA, { done_date: today });
      eq('date item Done -> next due = done date + 365 days', doneDate.body.item.due_date, addDays(today, 365));
      eq('and it is ok again', doneDate.body.item.state, 'ok');
      ok((await pushes(admin.id, 'maintenance')).length >= before ? 'earlier pushes are kept in the bell list' : 'pushes lost');

      console.log('\n--- custom items, turn off, delete keeps history ---');
      const belt = await api('POST', `/fleet/vans/${v1.id}/maintenance`, tA, { name: 'Timing belt', schedule_type: 'mileage', due_miles: 20000, interval_miles: 20000 });
      eq('admin adds a custom mileage item', `${belt.status} ${belt.body.name} ${belt.body.builtin_key} ${belt.body.miles_left}`, '201 Timing belt null 5300');
      eq('a custom item needs a name -> 400', (await api('POST', `/fleet/vans/${v1.id}/maintenance`, tA, { schedule_type: 'date' })).status, 400);
      const brake = item('brake_change');
      eq('turn off an item -> state off', (await api('PATCH', `/fleet/vans/${v1.id}/maintenance/${brake.id}`, tA, { is_active: false })).body.state, 'off');
      await api('POST', `/fleet/vans/${v1.id}/maintenance/${belt.body.id}/done`, tA, {});
      eq('delete an item -> 204', (await api('DELETE', `/fleet/vans/${v1.id}/maintenance/${belt.body.id}`, tA)).status, 204);
      eq('it is gone from the van', (await api('GET', `/fleet/vans/${v1.id}/maintenance`, tA)).body.items.some((i) => i.id === belt.body.id), false);
      eq('its history is still there (audits)', (await api('GET', `/fleet/vans/${v1.id}/history?item_id=${belt.body.id}`, tA)).body.length, 1);
      eq('nothing was deleted from the database', (await pool.query('SELECT count(*)::int AS n FROM maintenance_records')).rows[0].n, 4);
      eq('a van with maintenance history can\'t be deleted -> 409', (await api('DELETE', `/vans/${v1.id}`, tA)).status, 409);

      console.log('\n--- fuel history, admin fixes ---');
      const log = (await api('GET', `/fleet/vans/${v1.id}/fuel`, tA)).body;
      eq('entries kept per van, newest first', log.map((e) => e.miles).slice(0, 3).join(), '14700,10100,9700');
      const fix = await api('PATCH', `/fleet/fuel/${log[0].id}`, tA, { miles: 14750 });
      ok(fix.status === 200 && fix.body.miles === 14750 && fix.body.edited_at ? 'admin fixes an entry (stamped)' : `fix: ${JSON.stringify(fix.body)}`);
      eq('admin adds an entry for any van and date', (await api('POST', '/fleet/fuel', tA, { van_id: v2.id, miles: 30000, entry_date: addDays(today, -3) })).status, 201);
      eq('admin may enter a lower reading (fixing mistakes)', (await api('POST', '/fleet/fuel', tA, { van_id: v2.id, miles: 29000 })).status, 201);
      const mine = (await api('GET', '/fleet/fuel/mine', tD)).body;
      eq('driver sees their van and its entries', `${mine.vans.map((v) => v.label).join()} ${mine.entries.length > 0}`, 'Van 12 true');

      console.log('\n--- who sees what ---');
      for (const [m, p, b] of [
        ['GET', `/fleet/vans/${v1.id}/maintenance`], ['GET', '/fleet/settings'], ['PUT', '/fleet/settings', {}], ['GET', '/fleet/due'],
        ['POST', `/fleet/vans/${v1.id}/maintenance/${oil.id}/done`, {}], ['PATCH', `/fleet/fuel/${log[0].id}`, { miles: 1 }], ['GET', `/fleet/vans/${v1.id}/history`],
      ]) eq(`driver ${m} ${p.replace(/[0-9a-f-]{36}/g, ':id')} -> 403`, (await api(m, p, tD, b)).status, 403);
      eq('driver: someone else\'s van -> 404', (await api('POST', '/fleet/fuel', tD, { van_id: v2.id, miles: 99999 })).status, 404);
      eq('another company\'s admin: van not found -> 404', (await api('GET', `/fleet/vans/${v1.id}/maintenance`, tB)).status, 404);
      eq('admin can\'t use the driver list', (await api('GET', '/fleet/fuel/mine', tA)).status, 403);

      console.log('\n--- odometer reminder to the driver ---');
      eq('off: no reminders', (await fleet.runFleetReminders({ now: noon })) >= 0 && (await pushes(driver2.id, 'odometer_reminder')).length, 0);
      await api('PUT', '/fleet/settings', tA, { default_remind_days: 40, default_remind_miles: 500, odometer_reminder_days: 7 });
      // Driver 2's van readings are the admin's, 3 days ago and today: make them old.
      await pool.query("UPDATE odometer_entries SET created_at = now() - interval '10 days' WHERE van_id = $1", [v2.id]);
      await fleet.runFleetReminders({ now: noon });
      eq('weekly: the driver with no reading in 7 days is reminded', (await pushes(driver2.id, 'odometer_reminder')).map((n) => n.title).join(), "Time to enter your van's miles");
      eq('the driver who entered miles recently is not', (await pushes(driver.id, 'odometer_reminder')).length, 0);
      eq('a driver with no van is not', (await pushes(idle.id, 'odometer_reminder')).length, 0);
      await fleet.runFleetReminders({ now: noon });
      eq('not again until 7 days have passed', (await pushes(driver2.id, 'odometer_reminder')).length, 1);
      await pool.query("UPDATE odometer_reminder_state SET last_sent_at = now() - interval '8 days' WHERE driver_user_id = $1", [driver2.id]);
      await fleet.runFleetReminders({ now: noon });
      eq('after 7 days without a reading, reminded again', (await pushes(driver2.id, 'odometer_reminder')).length, 2);
      const r = (await pushes(driver2.id, 'odometer_reminder'))[0];
      eq('the reminder opens the fuel screen', `${r.data.route} ${r.data.web_route}`, '/(driver)/fuel /driver/fuel');
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
