// V2 driver week schedule: GET /schedule/week?start=YYYY-MM-DD. Seven calendar days, each with
// the driver's morning and afternoon runs, built from the assignment dates (start/end), with that
// day's override applied. Same driver scope as the rest of the app: own, not-ended assignments.
const PG_PORT = 5469;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-19';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('19-week-schedule');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5900';
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
  const epg = await startEmbeddedPostgres('19-week-schedule', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const user = (email, role) => ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id",
      [email, hash, email.split('@')[0], role, A.id]
    );
    await user('admin@a.com', 'company_admin');
    const dA = await user('da@a.com', 'driver');
    const dB = await user('db@a.com', 'driver');
    await user('parent@a.com', 'parent');
    const van = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'V-1','Ford','Transit',2022) RETURNING id", [A.id]);
    const student = (name) => ins('INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,$3) RETURNING id', [A.id, S.id, name]);
    const assign = (stu, drv, start, end, shift) => ins(
      "INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,end_date,shift_period,days_of_week) VALUES($1,$2,$3,$4,$5,$6,$7,'{1,2,3,4,5,6,7}') RETURNING id",
      [A.id, stu.id, drv.id, van.id, start, end, shift]
    );

    // Week under test: 2099-03-02 .. 2099-03-08 (far future, so "not ended as of today" holds).
    const aAll = await assign(await student('All Week'), dA, '2020-01-01', null, 'both');
    await assign(await student('Starts Wed'), dA, '2099-03-04', null, 'morning');
    await assign(await student('Ends Thu'), dA, '2020-01-01', '2099-03-05', 'afternoon');
    await assign(await student('Other Driver Kid'), dB, '2020-01-01', null, 'both');
    await assign(await student('Ended Kid'), dA, '2020-01-01', '2020-12-31', 'both');
    await ins("INSERT INTO assignment_schedule_overrides(company_id,assignment_id,override_date,skip,note) VALUES($1,$2,'2099-03-03',true,'Field trip') RETURNING id", [A.id, aAll.id]);

    const server = createApp().listen(5900);
    try {
      const tA = await login('da@a.com');
      const tB = await login('db@a.com');
      const tAdmin = await login('admin@a.com');
      const tParent = await login('parent@a.com');

      console.log('--- normal week ---');
      const wk = await api('GET', '/schedule/week?start=2099-03-02', tA);
      eq('GET /schedule/week -> 200', wk.status, 200);
      eq('start is the requested day', wk.body?.start, '2099-03-02');
      eq('end is start + 6 days', wk.body?.end, '2099-03-08');
      eq('7 days returned, as calendar strings', JSON.stringify(wk.body?.days?.map((d) => d.date)),
        JSON.stringify(['2099-03-02', '2099-03-03', '2099-03-04', '2099-03-05', '2099-03-06', '2099-03-07', '2099-03-08']));
      const day = (date) => wk.body.days.find((d) => d.date === date);
      (wk.body.days.every((d) => names(d.morning).includes('All Week') && names(d.afternoon).includes('All Week')))
        ? ok("a 'both' assignment is on the morning and afternoon run every day")
        : bad('All Week missing on some day/run');
      const item = day('2099-03-02').morning.find((i) => i.student.name === 'All Week');
      (item && item.assignment_id === aAll.id && item.school.id === S.id && item.override === null && item.parent_skipped && item.no_show_reported)
        ? ok('items have the same shape as /schedule/today')
        : bad(`item: ${JSON.stringify(item)}`);
      const skipped = day('2099-03-03').morning.find((i) => i.student.name === 'All Week');
      (skipped?.override?.skip === true && skipped.override.note === 'Field trip')
        ? ok("that day's override is applied (skip + note on 2099-03-03 only)")
        : bad(`override: ${JSON.stringify(skipped?.override)}`);
      eq('the override does not leak to the next day', day('2099-03-04').morning.find((i) => i.student.name === 'All Week')?.override, null);

      console.log('\n--- assignment starting mid week ---');
      eq('not on Mon 03-02', names(day('2099-03-02').morning).includes('Starts Wed'), false);
      eq('not on Tue 03-03', names(day('2099-03-03').morning).includes('Starts Wed'), false);
      eq('on Wed 03-04 (start day)', names(day('2099-03-04').morning).includes('Starts Wed'), true);
      eq('on Sun 03-08', names(day('2099-03-08').morning).includes('Starts Wed'), true);
      eq('a morning-only assignment is never on the afternoon run', wk.body.days.some((d) => names(d.afternoon).includes('Starts Wed')), false);

      console.log('\n--- assignment ending mid week ---');
      eq('on Thu 03-05 (end day, inclusive)', names(day('2099-03-05').afternoon).includes('Ends Thu'), true);
      eq('not on Fri 03-06', names(day('2099-03-06').afternoon).includes('Ends Thu'), false);
      eq('an afternoon-only assignment is never on the morning run', wk.body.days.some((d) => names(d.morning).includes('Ends Thu')), false);

      console.log('\n--- driver scope ---');
      eq("driver A's week never has driver B's student", wk.body.days.some((d) => [...names(d.morning), ...names(d.afternoon)].includes('Other Driver Kid')), false);
      const wkB = await api('GET', '/schedule/week?start=2099-03-02', tB);
      eq("driver B's week has only driver B's student", JSON.stringify([...new Set(wkB.body.days.flatMap((d) => [...names(d.morning), ...names(d.afternoon)]))]), JSON.stringify(['Other Driver Kid']));
      const past = await api('GET', '/schedule/week?start=2020-06-01', tA);
      eq('past week -> 200', past.status, 200);
      eq("a past week doesn't bring back an ended assignment's student", past.body.days.some((d) => names(d.morning).includes('Ended Kid')), false);
      eq('company admin -> 403 (driver only)', (await api('GET', '/schedule/week?start=2099-03-02', tAdmin)).status, 403);
      eq('parent -> 403', (await api('GET', '/schedule/week?start=2099-03-02', tParent)).status, 403);

      console.log('\n--- dates ---');
      const yearEnd = await api('GET', '/schedule/week?start=2099-12-29', tA);
      eq('week across a year boundary ends 2100-01-04', yearEnd.body?.end, '2100-01-04');
      const leap = await api('GET', '/schedule/week?start=2096-02-26', tA);
      eq('leap year: 2096-02-29 is one of the days', leap.body?.days?.[3]?.date, '2096-02-29');
      const today = (await pool.query('SELECT CURRENT_DATE::text AS d')).rows[0].d;
      const thisWeek = await api('GET', `/schedule/week?start=${today}`, tA);
      const todaySchedule = await api('GET', '/schedule/today', tA);
      eq("the week's first day matches /schedule/today", JSON.stringify(names(thisWeek.body.days[0].morning.concat(thisWeek.body.days[0].afternoon.filter((i) => i.shift_period === 'afternoon')))),
        JSON.stringify(names(todaySchedule.body)));
      for (const bad400 of ['', '?start=', '?start=2099-3-2', '?start=2099-02-30', '?start=2098-02-29', '?start=abc', '?start=2099-13-01']) {
        eq(`GET /schedule/week${bad400} -> 400`, (await api('GET', `/schedule/week${bad400}`, tA)).status, 400);
      }
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
