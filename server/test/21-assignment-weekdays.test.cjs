// Days of the week on assignments: default Monday to Friday (also for assignments that existed
// before the column), validated on create/edit, and a driver never sees or works a run on a day
// it doesn't happen: /schedule/today, /schedule/week, trips, no-shows, payroll, parent skips.
// "Today" is the database's CURRENT_DATE, read from the database, like the server does.
const PG_PORT = 5471;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-21';
process.env.NODE_ENV = 'test';

const { execSync } = require('node:child_process');
const { createRecorder, startEmbeddedPostgres, runMigrateUp, SERVER_DIR } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('21-assignment-weekdays');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5960';
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
const names = (items) => items.map((i) => i.student.name).sort();

async function main() {
  const epg = await startEmbeddedPostgres('21-assignment-weekdays', PG_PORT);
  try {
    runMigrateUp();
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const hash = await hashPassword(PW);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const user = (email, role, col, id) => ins(
      `INSERT INTO users(email,password_hash,full_name,role,${col},email_verified_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id`,
      [email, hash, email.split('@')[0], role, id]
    );
    await user('admin@a.com', 'company_admin', 'company_id', A.id);
    await user('sa@s.com', 'school_admin', 'school_id', S.id);
    const d1 = await user('d1@a.com', 'driver', 'company_id', A.id);
    const d2 = await user('d2@a.com', 'driver', 'company_id', A.id);
    const d3 = await user('d3@a.com', 'driver', 'company_id', A.id);
    const parent = await user('parent@a.com', 'parent', 'company_id', A.id);
    const van = (plate) => ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,$2,'Ford','Transit',2022) RETURNING id", [A.id, plate]);
    const v1 = await van('V-1');
    const v2 = await van('V-2');
    const v3 = await van('V-3');
    const student = (name) => ins('INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,$3) RETURNING id', [A.id, S.id, name]);

    const { dow, today, monday } = (await pool.query(
      "SELECT EXTRACT(ISODOW FROM CURRENT_DATE)::int AS dow, CURRENT_DATE::text AS today, (CURRENT_DATE - (EXTRACT(ISODOW FROM CURRENT_DATE)::int - 1))::text AS monday"
    )).rows[0];
    const notToday = [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== dow);
    console.log(`(today is ${today}, ISO weekday ${dow}; this week starts ${monday})`);

    console.log('--- existing assignments get Monday to Friday ---');
    // Roll back 022, add an assignment the old way, run 022 again: the old row gets Mon-Fri.
    execSync('npm run migrate:down', { cwd: SERVER_DIR, stdio: 'ignore' });
    const legacyStu = await student('Legacy Kid');
    const legacy = await ins("INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date) VALUES($1,$2,$3,$4,'2020-01-01') RETURNING id", [A.id, legacyStu.id, d3.id, v3.id]);
    execSync('npm run migrate:up', { cwd: SERVER_DIR, stdio: 'ignore' });
    const legacyDays = (await pool.query('SELECT days_of_week FROM assignments WHERE id = $1', [legacy.id])).rows[0].days_of_week;
    eq('an assignment from before the migration now runs Monday to Friday', JSON.stringify(legacyDays), '[1,2,3,4,5]');

    const app = createApp();
    const server = app.listen(5960);
    try {
      const admin = await login('admin@a.com');
      const sa = await login('sa@s.com');
      const t1 = await login('d1@a.com');
      const tParent = await login('parent@a.com');

      console.log('\n--- create / edit: default, validation ---');
      const sDefault = await student('Default Kid');
      const aDefault = await api('POST', '/assignments', admin, { student_id: sDefault.id, driver_user_id: d2.id, van_id: v2.id, start_date: '2020-01-01' });
      eq('no days given -> Monday to Friday', JSON.stringify(aDefault.body?.days_of_week), '[1,2,3,4,5]');
      const sToday = await student('Today Kid');
      const aToday = await api('POST', '/assignments', admin, { student_id: sToday.id, driver_user_id: d1.id, van_id: v1.id, start_date: '2020-01-01', days_of_week: [dow, dow] });
      eq("runs only today's weekday -> 201, duplicates removed", JSON.stringify([aToday.status, aToday.body?.days_of_week]), JSON.stringify([201, [dow]]));
      const sOther = await student('Other Days Kid');
      const aOther = await api('POST', '/assignments', admin, { student_id: sOther.id, driver_user_id: d1.id, van_id: v1.id, start_date: '2020-01-01', days_of_week: notToday.slice().reverse() });
      eq('every other day -> 201, days sorted', JSON.stringify([aOther.status, aOther.body?.days_of_week]), JSON.stringify([201, notToday]));
      for (const bad of [[], [0], [8], ['1'], [1.5], 'mon']) {
        eq(`days_of_week ${JSON.stringify(bad)} -> 400`, (await api('POST', '/assignments', admin, { student_id: sDefault.id, driver_user_id: d2.id, van_id: v2.id, start_date: '2030-01-01', days_of_week: bad })).status, 400);
      }
      eq('edit to an empty list -> 400', (await api('PATCH', `/assignments/${aDefault.body.id}`, admin, { days_of_week: [] })).status, 400);
      const edited = await api('PATCH', `/assignments/${aDefault.body.id}`, admin, { days_of_week: [6, 7] });
      eq('edit to the weekend -> 200', JSON.stringify([edited.status, edited.body?.days_of_week]), JSON.stringify([200, [6, 7]]));
      await api('PATCH', `/assignments/${aDefault.body.id}`, admin, { days_of_week: [1, 2, 3, 4, 5] });

      console.log('\n--- driver: today and week show only days the run happens ---');
      const todayItems = (await api('GET', '/schedule/today', t1)).body;
      eq("/schedule/today has the run for today's weekday and not the other one", JSON.stringify(names(todayItems)), JSON.stringify(['Today Kid']));
      const week = (await api('GET', `/schedule/week?start=${monday}`, t1)).body;
      const dayOf = (iso) => week.days.find((d) => d.date === iso);
      const todayInWeek = dayOf(today);
      eq("the week: today's card has only Today Kid", JSON.stringify(names([...todayInWeek.morning, ...todayInWeek.afternoon].filter((v, i, a) => a.findIndex((x) => x.assignment_id === v.assignment_id) === i))), JSON.stringify(['Today Kid']));
      const wrong = week.days.filter((d, i) => {
        const shown = new Set([...d.morning, ...d.afternoon].map((x) => x.student.name));
        const isoDow = i + 1; // the week starts on Monday
        return shown.has('Today Kid') !== (isoDow === dow) || shown.has('Other Days Kid') !== (isoDow !== dow);
      });
      eq('the week: each run is on exactly its own weekdays, all 7 days', wrong.map((d) => d.date).join(','), '');

      const t2 = await login('d2@a.com');
      const week2 = (await api('GET', `/schedule/week?start=${monday}`, t2)).body;
      const weekendRuns = week2.days.slice(5).flatMap((d) => [...d.morning, ...d.afternoon]).length;
      const weekdayRuns = week2.days.slice(0, 5).filter((d) => d.morning.length > 0).length;
      eq('a Monday-to-Friday run is on Monday to Friday', weekdayRuns, 5);
      eq('...and never on Saturday or Sunday', weekendRuns, 0);

      console.log('\n--- driver writes need a run today ---');
      await api('POST', '/sessions/checkin', t1, { shift_period: 'morning' });
      eq("log a trip for today's run -> 201", (await api('POST', '/trips', t1, { student_id: sToday.id, trip_type: 'pickup', shift_period: 'morning' })).status, 201);
      eq('log a trip for a run that is not on today -> 409', (await api('POST', '/trips', t1, { student_id: sOther.id, trip_type: 'pickup', shift_period: 'morning' })).status, 409);
      eq('no-show for a run that is not on today -> 409', (await api('POST', `/schedule/${aOther.body.id}/no-show`, t1, { shift_period: 'morning' })).status, 409);

      console.log('\n--- payroll: a run that is not on that day does not block the shift ---');
      await api('PUT', `/payroll/rules/${d1.id}`, admin, { rate_type: 'daily', rate_cents: 10000 });
      const pickup = (await api('GET', '/trips', t1)).body.find((t) => t.student_id === sToday.id);
      await api('POST', `/trips/${pickup.id}/confirm`, sa);
      const drop = await api('POST', '/trips', t1, { student_id: sToday.id, trip_type: 'dropoff', shift_period: 'morning' });
      await api('POST', `/trips/${drop.body.id}/confirm`, sa);
      const open = (await api('GET', '/sessions', t1)).body.find((s) => s.check_out_at === null);
      await api('POST', `/sessions/${open.id}/checkout`, t1, {});
      const pay = (await api('GET', `/payroll/summary/${d1.id}`, admin)).body;
      eq("morning shift counts as complete (Other Days Kid doesn't run today): half the daily rate", pay?.base_pay_cents, 5000);

      console.log('\n--- conflicts only on shared weekdays ---');
      const sSplit = await student('Split Days Kid');
      eq('driver 2 has Split Days Kid Mon-Wed -> 201',
        (await api('POST', '/assignments', admin, { student_id: sSplit.id, driver_user_id: d2.id, van_id: v2.id, start_date: '2020-01-01', days_of_week: [1, 2, 3] })).status, 201);
      eq('driver 3 takes the same student Thu-Fri (no shared day) -> 201',
        (await api('POST', '/assignments', admin, { student_id: sSplit.id, driver_user_id: d3.id, van_id: v3.id, start_date: '2020-01-01', days_of_week: [4, 5] })).status, 201);
      eq('driver 1 on Wednesday too (shares a day) -> 409',
        (await api('POST', '/assignments', admin, { student_id: sSplit.id, driver_user_id: d1.id, van_id: v1.id, start_date: '2020-01-01', days_of_week: [3] })).status, 409);
      // Driver 2 already drives van 2 Monday to Friday; handing them this run (still on van 1) on
      // shared weekdays would put them in two vans.
      const moveToShared = await api('PATCH', `/assignments/${aOther.body.id}`, admin, { driver_user_id: d2.id });
      eq('editing a run onto a driver who drives another van on shared days -> 409', moveToShared.status, 409);

      console.log('\n--- parent: no ride on a day it doesn\'t run ---');
      await ins('INSERT INTO parent_students(parent_user_id,student_id,company_id) VALUES($1,$2,$3) RETURNING id', [parent.id, sOther.id, A.id]);
      const detail = (await api('GET', `/parent/students/${sOther.id}/detail`, tParent)).body;
      (detail.transport.length === 1 && detail.transport[0].runs_today === false && JSON.stringify(detail.transport[0].days_of_week) === JSON.stringify(notToday))
        ? ok('detail says the ride exists but runs_today is false, with its days')
        : bad(`detail: ${JSON.stringify(detail.transport)}`);
      eq('skip_today is false on a day with no ride', detail.skip_today, false);
      const status = (await api('GET', `/parent/students/${sOther.id}/skip-status`, tParent)).body;
      eq('skip-status: nothing to skip today', status?.eligible, false);
      eq('skip-pickup on a day with no ride -> 400', (await api('POST', `/parent/students/${sOther.id}/skip-pickup`, tParent)).status, 400);
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
