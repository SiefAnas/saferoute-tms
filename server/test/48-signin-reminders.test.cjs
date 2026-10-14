// Driver sign-in reminder (branch signin-reminder): N minutes before the FIRST STOP of each run that
// day (earliest pickup for the morning, earliest drop-off for the afternoon, with that day's
// overrides), only to drivers not yet signed in for that run, never with no run, once per run, never
// after the first stop. Company default (null = off) and per-driver override (minutes / off), and
// the settings API (admin only).
const PG_PORT = 5524;
const HTTP_PORT = 6049;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-48';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const push = require('../src/services/push.js');
const { runSigninReminders } = require('../src/services/signinReminders.js');
const { nowInZone } = require('../src/time/businessDate.js');

const rec = createRecorder('48-signin-reminders');
const { ok, eq } = rec;
const BASE = `http://localhost:${HTTP_PORT}`;
const PW = 'Secret123!';
const TZ = 'America/New_York';

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

// The instant when New York's clock shows `hh:mm` on today's New York date.
const DAY = nowInZone(TZ, new Date()).date;
function at(hh, mm) {
  const target = hh * 60 + mm;
  let t = Date.parse(`${DAY}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  for (let i = 0; i < 3; i += 1) {
    const l = nowInZone(TZ, new Date(t));
    const dayShift = l.date < DAY ? 1440 : l.date > DAY ? -1440 : 0;
    t += (target - l.minutesOfDay + dayShift) * 60000;
  }
  return new Date(t);
}
const reminders = async (userId) =>
  (await pool.query("SELECT title, body, data FROM notifications WHERE user_id = $1 AND category = 'signin_reminder' ORDER BY created_at", [userId])).rows;

async function main() {
  const epg = await startEmbeddedPostgres('48-signin-reminders', PG_PORT);
  try {
    runMigrateUp();
    push.setTransportsForTest({ fetchFn: async () => { throw new Error('no network in tests'); } });
    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins(`INSERT INTO companies(name,claim_status,claimed_at,timezone) VALUES('Co A','claimed',now(),'${TZ}') RETURNING id`);
    const B = await ins(`INSERT INTO companies(name,claim_status,claimed_at,timezone) VALUES('Co B','claimed',now(),'${TZ}') RETURNING id`);
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const user = (email, role, company, name) => ins(
      'INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id',
      [email, hash, name, role, company]
    );
    await user('admin@a.example.test', 'company_admin', A.id, 'Ada Admin');
    const van = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'SR-1','Ford','Transit',2022) RETURNING id", [A.id]);
    const vanB = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'SR-B','Ford','Transit',2022) RETURNING id", [B.id]);
    // A driver with students at the given times. shift 'both' unless given.
    async function driverWith(name, runs, company = A.id, v = van.id) {
      const d = await user(`${name.toLowerCase()}@x.example.test`, 'driver', company, name);
      for (const [pickup, dropoff, shift = 'both'] of runs) {
        const st = await ins('INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,$3) RETURNING id', [company, S.id, `${name} kid`]);
        await ins(
          "INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,days_of_week,shift_period,pickup_time,dropoff_time) VALUES($1,$2,$3,$4,'2020-01-01','{1,2,3,4,5,6,7}',$5,$6,$7) RETURNING id",
          [company, st.id, d.id, v, shift, pickup, dropoff]
        );
      }
      return d;
    }
    // Dana: two morning stops (07:30 and 07:10 -> first stop 07:10), afternoon drop-offs 15:00 / 14:30.
    const dana = await driverWith('Dana', [['07:30', '15:00'], ['07:10', '14:30']]);
    const eli = await driverWith('Eli', [['08:00', null, 'morning']]); // will get 45 minutes
    const fay = await driverWith('Fay', [['08:00', null, 'morning']]); // company default 30
    const gus = await driverWith('Gus', [['07:10', null, 'morning']]); // reminders off for him
    const hal = await driverWith('Hal', [['07:10', null, 'morning']]); // signs in early
    const ivy = await user('ivy@x.example.test', 'driver', A.id, 'Ivy'); // no run at all
    const jo = await driverWith('Jo', [['07:10', null, 'morning']]); // today's run cancelled (override skip)
    const kai = await driverWith('Kai', [['07:10', null, 'morning']]); // parent skipped today
    const lee = await driverWith('Lee', [['09:00', null, 'morning']]); // time moved today: 07:10 by override
    const bob = await driverWith('Bob', [['07:10', null, 'morning']], B.id, vanB.id); // company B: reminders off

    const joA = (await pool.query('SELECT id FROM assignments WHERE driver_user_id = $1', [jo.id])).rows[0];
    await pool.query("INSERT INTO assignment_schedule_overrides(company_id,assignment_id,override_date,skip) VALUES($3,$1,$2,true)", [joA.id, DAY, A.id]);
    const kaiA = (await pool.query('SELECT student_id FROM assignments WHERE driver_user_id = $1', [kai.id])).rows[0];
    const parent = await user('parent@a.example.test', 'parent', A.id, 'Pat Parent');
    await pool.query("INSERT INTO pickup_skips(company_id,student_id,parent_user_id,skip_date,shift_period) VALUES($1,$2,$3,$4,'morning')", [A.id, kaiA.student_id, parent.id, DAY]);
    const leeA = (await pool.query('SELECT id FROM assignments WHERE driver_user_id = $1', [lee.id])).rows[0];
    await pool.query("INSERT INTO assignment_schedule_overrides(company_id,assignment_id,override_date,pickup_time) VALUES($3,$1,$2,'07:10')", [leeA.id, DAY, A.id]);

    const app = createApp();
    const server = app.listen(HTTP_PORT);
    try {
      const tA = await login('admin@a.example.test');
      const tDana = await login('dana@x.example.test');

      console.log('--- settings ---');
      const s0 = (await api('GET', '/signin-reminders', tA)).body;
      eq('off by default (no company minutes)', `${s0.default_minutes} ${s0.drivers.every((d) => d.effective_minutes === null)}`, 'null true');
      eq('nothing is sent while off', await runSigninReminders({ now: at(6, 50) }), 0);
      eq('admin sets the company default to 30 minutes', (await api('PUT', '/signin-reminders', tA, { default_minutes: 30 })).body.default_minutes, 30);
      eq('minutes out of range -> 400', (await api('PUT', '/signin-reminders', tA, { default_minutes: 2 })).status, 400);
      eq('Eli gets his own 45 minutes', (await api('PUT', `/signin-reminders/drivers/${eli.id}`, tA, { mode: 'custom', minutes: 45 })).body.effective_minutes, 45);
      eq('Gus turned off', (await api('PUT', `/signin-reminders/drivers/${gus.id}`, tA, { mode: 'off' })).body.effective_minutes, null);
      eq('custom without minutes -> 400', (await api('PUT', `/signin-reminders/drivers/${fay.id}`, tA, { mode: 'custom' })).status, 400);
      eq('a driver can\'t change settings -> 403', (await api('PUT', '/signin-reminders', tDana, { default_minutes: 10 })).status, 403);
      eq('another company\'s driver -> 404', (await api('PUT', `/signin-reminders/drivers/${bob.id}`, tA, { mode: 'off' })).status, 404);

      // Hal signs in for the morning at 06:20, before his reminder window (06:40-07:10).
      await pool.query("INSERT INTO sessions(user_id,company_id,shift_period,check_in_at) VALUES($1,$2,'morning',$3)", [hal.id, A.id, at(6, 20)]);

      console.log('\n--- timing: from the first stop of the run ---');
      eq('06:35: too early for a 07:10 first stop with 30 minutes', await runSigninReminders({ now: at(6, 35) }), 0);
      await runSigninReminders({ now: at(6, 45) });
      const danaR = await reminders(dana.id);
      eq('06:45: Dana is reminded (first stop 07:10, the earlier of her two pickups)', danaR.length, 1);
      ok(/morning run's first stop is at 7:10 AM \(in 25 min\)/.test(danaR[0]?.body) ? 'it says the first stop time and how long' : `body: ${danaR[0]?.body}`);
      eq('it opens the driver\'s Today screen', `${danaR[0]?.data?.route} ${danaR[0]?.data?.web_route}`, '/(driver)/today /driver');
      eq('Lee too: today\'s override moved his first stop to 07:10', (await reminders(lee.id)).length, 1);
      eq('Fay (08:00, 30 min) not yet at 06:45', (await reminders(fay.id)).length, 0);
      eq('Eli (08:00, his own 45 min) not yet at 06:45', (await reminders(eli.id)).length, 0);
      await runSigninReminders({ now: at(6, 50) });
      eq('a second sweep doesn\'t remind Dana again', (await reminders(dana.id)).length, 1);

      console.log('\n--- per-driver override ---');
      await runSigninReminders({ now: at(7, 20) });
      eq('07:20: Eli is reminded (45 minutes before 08:00)', (await reminders(eli.id)).length, 1);
      eq('07:20: Fay is not (30 minutes before 08:00 is 07:30)', (await reminders(fay.id)).length, 0);
      await runSigninReminders({ now: at(7, 31) });
      eq('07:31: Fay is reminded', (await reminders(fay.id)).length, 1);
      eq('Gus (turned off) gets nothing', (await reminders(gus.id)).length, 0);

      console.log('\n--- signed in, no run, cancelled, other company ---');
      eq('Hal already signed in: nothing', (await reminders(hal.id)).length, 0);
      eq('Ivy has no run today: nothing', (await reminders(ivy.id)).length, 0);
      eq('Jo\'s run is cancelled today ("no ride" override): nothing', (await reminders(jo.id)).length, 0);
      eq('Kai\'s only student was skipped by the parent: nothing', (await reminders(kai.id)).length, 0);
      eq('Company B has reminders off: nothing', (await reminders(bob.id)).length, 0);

      console.log('\n--- afternoon run, and never after the first stop ---');
      // Dana signs in for the morning (doesn't count for the afternoon).
      await pool.query("INSERT INTO sessions(user_id,company_id,shift_period,check_in_at,check_out_at,duration_minutes) VALUES($1,$2,'morning',$3,$4,60)", [dana.id, A.id, at(7, 0), at(8, 0)]);
      await runSigninReminders({ now: at(14, 35) });
      eq('14:35 is after the afternoon first stop (14:30): no late reminder', (await reminders(dana.id)).length, 1);
      await pool.query("DELETE FROM signin_reminders_sent WHERE driver_user_id = $1 AND shift_period = 'afternoon'", [dana.id]);
      await runSigninReminders({ now: at(14, 5) });
      const aft = await reminders(dana.id);
      eq('14:05: afternoon reminder (first drop-off 14:30), morning sign-in doesn\'t count', aft.length, 2);
      ok(/afternoon run's first stop is at 2:30 PM/.test(aft[1]?.body) ? 'afternoon text' : `body: ${aft[1]?.body}`);

      console.log('\n--- turn it off again ---');
      await api('PUT', `/signin-reminders/drivers/${gus.id}`, tA, { mode: 'default' });
      eq('back to the default', (await api('GET', '/signin-reminders', tA)).body.drivers.find((d) => d.id === gus.id)?.mode, 'default');
      eq('company off -> 200', (await api('PUT', '/signin-reminders', tA, { default_minutes: null })).body.default_minutes, null);
      await pool.query('DELETE FROM signin_reminders_sent');
      eq('with the company off nobody is reminded (even with their own minutes)', await runSigninReminders({ now: at(7, 20) }), 0);
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
