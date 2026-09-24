// Pickup / drop-off locations: morning home → school, afternoon school → home, and extra
// addresses ("Fridays: Grandparents") that replace home on their weekdays and dates for the leg
// they cover. The server decides (route); drivers see only their students, parents only their
// children. "Today" is the database's CURRENT_DATE.
const PG_PORT = 5472;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-22';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('22-stops-extra-addresses');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5970';
const PW = 'Secret123!';
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

async function main() {
  const epg = await startEmbeddedPostgres('22-stops-extra-addresses', PG_PORT);
  try {
    runMigrateUp();
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const hash = await hashPassword(PW);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const B = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,address,state,zip_code,claim_status,claimed_at) VALUES('Lincoln Elementary','200 School St','MA','02139','claimed',now()) RETURNING id");
    const user = (email, role, id) => ins(
      `INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id`,
      [email, hash, email.split('@')[0], role, id]
    );
    await user('admin@a.com', 'company_admin', A.id);
    await user('admin@b.com', 'company_admin', B.id);
    const dA = await user('da@a.com', 'driver', A.id);
    const dB = await user('db@a.com', 'driver', A.id);
    const parent = await user('parent@a.com', 'parent', A.id);
    const van = (c, plate) => ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,$2,'Ford','Transit',2022) RETURNING id", [c, plate]);
    const v1 = await van(A.id, 'V-1');
    const v2 = await van(A.id, 'V-2');
    const kid = (c, name, street) => ins("INSERT INTO students(company_id,school_id,full_name,street_address,city,state,zip_code) VALUES($1,$2,$3,$4,'Boston','MA','02139') RETURNING id", [c, S.id, name, street]);
    const maya = await kid(A.id, 'Maya', '12 Oak St');
    const leo = await kid(A.id, 'Leo', '9 Elm St');
    const other = await kid(B.id, 'Other Co Kid', '1 Far Rd');
    const assign = (stu, drv, v, shift) => ins(
      "INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,shift_period,days_of_week) VALUES($1,$2,$3,$4,'2020-01-01',$5,'{1,2,3,4,5,6,7}') RETURNING id",
      [A.id, stu.id, drv.id, v.id, shift]
    );
    await assign(maya, dA, v1, 'both');
    await assign(leo, dB, v2, 'both');
    await ins('INSERT INTO parent_students(parent_user_id,student_id,company_id) VALUES($1,$2,$3) RETURNING id', [parent.id, maya.id, A.id]);

    const { dow, today, monday, yesterday, tomorrow } = (await pool.query(
      `SELECT EXTRACT(ISODOW FROM CURRENT_DATE)::int AS dow, CURRENT_DATE::text AS today,
              (CURRENT_DATE - (EXTRACT(ISODOW FROM CURRENT_DATE)::int - 1))::text AS monday,
              (CURRENT_DATE - 1)::text AS yesterday, (CURRENT_DATE + 1)::text AS tomorrow`
    )).rows[0];

    const server = createApp().listen(5970);
    try {
      const adm = await login('admin@a.com');
      const admB = await login('admin@b.com');
      const tA = await login('da@a.com');
      const tB = await login('db@a.com');
      const tP = await login('parent@a.com');
      const todayItem = async () => (await api('GET', '/schedule/today', tA)).body.find((i) => i.student.id === maya.id);

      console.log('--- a normal day: home → school, school → home ---');
      let it = await todayItem();
      eq('morning from = home, with the address', JSON.stringify(it.route.morning.from), JSON.stringify({ kind: 'home', label: 'Home', address: '12 Oak St, Boston, MA 02139' }));
      eq('morning to = the school with its address', JSON.stringify(it.route.morning.to), JSON.stringify({ kind: 'school', label: 'Lincoln Elementary', address: '200 School St, MA 02139' }));
      eq('afternoon from = school', it.route.afternoon.from.kind, 'school');
      eq('afternoon to = home', it.route.afternoon.to.kind, 'home');

      console.log('\n--- admin manages extra addresses ---');
      const g = await api('POST', `/students/${maya.id}/addresses`, adm, {
        label: 'Grandparents', street_address: '5 Pine Rd', city: 'Quincy', state: 'ma', zip_code: '02169', days_of_week: [dow], applies_to: 'afternoon_dropoff',
      });
      eq('create an afternoon-only extra address for today -> 201', g.status, 201);
      eq('stored with normalized state and full address', g.body?.address, '5 Pine Rd, Quincy, MA 02169');
      for (const [label, body] of [
        ['missing label', { street_address: '1 St', days_of_week: [1], applies_to: 'both' }],
        ['bad applies_to', { label: 'X', street_address: '1 St', days_of_week: [1], applies_to: 'evening' }],
        ['empty weekdays', { label: 'X', street_address: '1 St', days_of_week: [], applies_to: 'both' }],
        ['end before start', { label: 'X', street_address: '1 St', days_of_week: [1], applies_to: 'both', start_date: '2026-05-10', end_date: '2026-05-01' }],
        ['bad date', { label: 'X', street_address: '1 St', days_of_week: [1], applies_to: 'both', start_date: '10/05/2026' }],
      ]) {
        eq(`${label} -> 400`, (await api('POST', `/students/${maya.id}/addresses`, adm, body)).status, 400);
      }
      eq("another company's admin -> 404", (await api('POST', `/students/${maya.id}/addresses`, admB, { label: 'X', street_address: '1 St', days_of_week: [1], applies_to: 'both' })).status, 404);
      eq('adding to another company\'s student -> 404', (await api('POST', `/students/${other.id}/addresses`, adm, { label: 'X', street_address: '1 St', days_of_week: [1], applies_to: 'both' })).status, 404);
      eq('a driver cannot add addresses -> 403', (await api('POST', `/students/${maya.id}/addresses`, tA, { label: 'X', street_address: '1 St', days_of_week: [1], applies_to: 'both' })).status, 403);
      eq('a driver cannot list addresses -> 403', (await api('GET', `/students/${maya.id}/addresses`, tA)).status, 403);
      eq('a parent is kept off /students -> 403', (await api('GET', `/students/${maya.id}/addresses`, tP)).status, 403);
      const detailAdmin = (await api('GET', `/students/${maya.id}`, adm)).body;
      eq('admin student detail lists the extra addresses', detailAdmin.extra_addresses?.length, 1);
      eq('driver student detail does not include the list', 'extra_addresses' in (await api('GET', `/students/${maya.id}`, tA)).body, false);

      console.log('\n--- the extra address applies to today\'s afternoon only ---');
      it = await todayItem();
      eq('afternoon to = the extra address', JSON.stringify(it.route.afternoon.to), JSON.stringify({ kind: 'extra', label: 'Grandparents', address: '5 Pine Rd, Quincy, MA 02169' }));
      eq('morning from is still home (afternoon-only address)', it.route.morning.from.kind, 'home');

      console.log('\n--- morning-only, ended, and not yet started ---');
      await api('POST', `/students/${maya.id}/addresses`, adm, { label: 'Old Aunt', street_address: '3 Old Ln', days_of_week: EVERY_DAY, applies_to: 'morning_pickup', end_date: yesterday });
      await api('POST', `/students/${maya.id}/addresses`, adm, { label: 'Future Dad', street_address: '8 New St', days_of_week: EVERY_DAY, applies_to: 'morning_pickup', start_date: tomorrow });
      it = await todayItem();
      eq('an ended address does not apply (morning still home)', it.route.morning.from.kind, 'home');
      const week = (await api('GET', `/schedule/week?start=${monday}`, tA)).body;
      const onDay = (iso) => week.days.find((d) => d.date === iso)?.morning.find((i) => i.student.id === maya.id);
      const tomorrowInWeek = week.days.some((d) => d.date === tomorrow);
      if (tomorrowInWeek) {
        eq('the week: tomorrow the future address applies', onDay(tomorrow)?.route.morning.from.label, 'Future Dad');
      } else {
        ok('(today is Sunday: tomorrow is next week, checked below)');
        const next = (await api('GET', `/schedule/week?start=${tomorrow}`, tA)).body;
        eq('next week: tomorrow the future address applies', next.days[0].morning.find((i) => i.student.id === maya.id)?.route.morning.from.label, 'Future Dad');
      }
      eq('the week: today the afternoon extra address shows', week.days.find((d) => d.date === today)?.afternoon.find((i) => i.student.id === maya.id)?.route.afternoon.to.label, 'Grandparents');
      const otherDay = week.days.find((d) => d.date !== today && d.date !== tomorrow);
      eq('the week: another weekday afternoon is home', otherDay.afternoon.find((i) => i.student.id === maya.id)?.route.afternoon.to.kind, 'home');
      const morningOnly = await api('POST', `/students/${maya.id}/addresses`, adm, { label: 'Neighbor', street_address: '7 Side St', days_of_week: [dow], applies_to: 'morning_pickup' });
      it = await todayItem();
      eq('a morning-only address changes the morning pickup', it.route.morning.from.label, 'Neighbor');
      eq('...and not the afternoon drop-off (still Grandparents)', it.route.afternoon.to.label, 'Grandparents');

      console.log('\n--- edit and remove ---');
      const edited = await api('PATCH', `/students/${maya.id}/addresses/${morningOnly.body.id}`, adm, { label: 'Next door' });
      eq('edit the label -> 200', JSON.stringify([edited.status, edited.body?.label]), JSON.stringify([200, 'Next door']));
      eq('edit with end before start -> 400', (await api('PATCH', `/students/${maya.id}/addresses/${morningOnly.body.id}`, adm, { start_date: '2030-01-10', end_date: '2030-01-01' })).status, 400);
      eq('remove -> 204', (await api('DELETE', `/students/${maya.id}/addresses/${morningOnly.body.id}`, adm)).status, 204);
      eq('remove again -> 404', (await api('DELETE', `/students/${maya.id}/addresses/${morningOnly.body.id}`, adm)).status, 404);
      it = await todayItem();
      eq('after removing, the morning is home again', it.route.morning.from.kind, 'home');

      console.log('\n--- parent sees today\'s route and the list; scope ---');
      const pd = (await api('GET', `/parent/students/${maya.id}/detail`, tP)).body;
      eq("parent: today's drop-off address is the extra one", pd.transport[0].route.afternoon.to.label, 'Grandparents');
      eq('parent: the extra addresses are listed (read-only)', pd.extra_addresses.map((x) => x.label).sort().join(','), 'Future Dad,Grandparents,Old Aunt');
      eq("parent: another child's detail -> 404", (await api('GET', `/parent/students/${leo.id}/detail`, tP)).status, 404);
      const bToday = (await api('GET', '/schedule/today', tB)).body;
      eq("driver B's schedule has only Leo (no Maya addresses)", bToday.map((i) => i.student.id).join(','), leo.id);
      eq("driver B can't read Maya -> 404", (await api('GET', `/students/${maya.id}`, tB)).status, 404);
      const leak = JSON.stringify(bToday).includes('Pine Rd') || JSON.stringify(bToday).includes('12 Oak St');
      eq("driver B's schedule contains none of Maya's addresses", leak, false);
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
