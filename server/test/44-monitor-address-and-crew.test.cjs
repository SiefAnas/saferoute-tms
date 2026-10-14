// Monitor address + who rides with whom (branch monitor-address-and-crew):
//  - a monitor has a home address (street, city, state, zip; migration 034). The company admin sets
//    it at creation and edits it (PATCH /users/:id); the monitor edits their own (PATCH /users/me).
//    Other roles can't use those fields. The four go together and are validated like a student's.
//  - the driver sees which monitor rides on each run: GET /schedule/monitors (today) and
//    /schedule/week (monitors per day), with name, phone and address. No monitor -> empty list.
//    Weekdays and shift decide the run; deactivated monitors and other companies never show.
//  - the monitor sees their driver's name and phone and the van (GET /monitor/me).
const PG_PORT = 5520;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-44';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('44-monitor-address-and-crew');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:6044';
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
const names = (list) => (list ?? []).map((m) => m.full_name).join(',');

async function main() {
  const epg = await startEmbeddedPostgres('44-monitor-address-and-crew', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const B = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const user = (email, role, company, fullName, phone = null) => ins(
      'INSERT INTO users(email,password_hash,full_name,role,company_id,phone,email_verified_at) VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING id',
      [email, hash, fullName, role, company, phone]
    );
    await user('admin@a.example.test', 'company_admin', A.id, 'Admin A');
    await user('admin@b.example.test', 'company_admin', B.id, 'Admin B');
    const driver = await user('driver@a.example.test', 'driver', A.id, 'Dana Driver', '555-0101');
    const lonely = await user('lonely@a.example.test', 'driver', A.id, 'Lee Alone');
    const driverB = await user('driver@b.example.test', 'driver', B.id, 'Bo Driver');
    const parent = await user('parent@a.example.test', 'parent', A.id, 'Pat Parent', '555-0300');
    const sam = await user('sam@a.example.test', 'monitor', A.id, 'Sam Monitor', '555-0201');
    const gone = await user('gone@a.example.test', 'monitor', A.id, 'Gina Gone', '555-0202');
    const monB = await user('mon@b.example.test', 'monitor', B.id, 'Bea Monitor');
    const student = await ins("INSERT INTO students(company_id,school_id,full_name,street_address,city,state,zip_code) VALUES($1,$2,'Kid One','1 Elm St','Salem','MA','01970') RETURNING id", [A.id, S.id]);
    const van = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year,number,color) VALUES($1,'VAN-44','Ford','Transit',2022,'12','Blue') RETURNING id", [A.id]);
    await ins("INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,days_of_week) VALUES($1,$2,$3,$4,'2020-01-01','{1,2,3,4,5,6,7}') RETURNING id", [A.id, student.id, driver.id, van.id]);

    const app = createApp();
    const server = app.listen(6044);
    try {
      const tA = await login('admin@a.example.test');
      const tB = await login('admin@b.example.test');
      const tDriver = await login('driver@a.example.test');
      const tLonely = await login('lonely@a.example.test');
      const tDriverB = await login('driver@b.example.test');
      const tSam = await login('sam@a.example.test');
      const tParent = await login('parent@a.example.test');

      console.log('--- address: admin create + edit ---');
      const mk = await api('POST', '/users', tA, {
        email: 'new@a.example.test', fullName: 'Nia New', role: 'monitor',
        streetAddress: '5 Pine Rd', city: 'Lynn', state: 'ma', zipCode: '01901',
      });
      eq('admin creates a monitor with an address -> 201', mk.status, 201);
      eq('address saved, state upper-cased', `${mk.body?.street_address}|${mk.body?.city}|${mk.body?.state}|${mk.body?.zip_code}`, '5 Pine Rd|Lynn|MA|01901');
      eq('formatted home_address', mk.body?.home_address, '5 Pine Rd, Lynn, MA 01901');
      eq('creating a monitor with half an address -> 400', (await api('POST', '/users', tA, { email: 'half@a.example.test', fullName: 'Half', role: 'monitor', streetAddress: '1 A St' })).status, 400);
      eq('creating a driver with a street address -> 400 (monitors only)', (await api('POST', '/users', tA, { email: 'd2@a.example.test', fullName: 'D2', role: 'driver', streetAddress: '1 A St', city: 'X', state: 'MA', zipCode: '01901' })).status, 400);

      const addr = { street_address: '9 Oak Ave', city: 'Salem', state: 'MA', zip_code: '01970' };
      const edit = await api('PATCH', `/users/${sam.id}`, tA, addr);
      eq('admin sets an existing monitor\'s address -> 200', edit.status, 200);
      eq('PATCH returns the formatted address', edit.body?.home_address, '9 Oak Ave, Salem, MA 01970');
      eq('bad zip -> 400', (await api('PATCH', `/users/${sam.id}`, tA, { ...addr, zip_code: '1234' })).status, 400);
      eq('bad state -> 400', (await api('PATCH', `/users/${sam.id}`, tA, { ...addr, state: 'ZZ' })).status, 400);
      eq('only some of the four -> 400', (await api('PATCH', `/users/${sam.id}`, tA, { city: 'Boston' })).status, 400);
      eq('a driver gets no street address via PATCH -> 400', (await api('PATCH', `/users/${driver.id}`, tA, addr)).status, 400);
      eq('company B admin edits company A monitor -> 404', (await api('PATCH', `/users/${sam.id}`, tB, addr)).status, 404);
      const listed = (await api('GET', '/monitors', tA)).body.find((m) => m.id === sam.id);
      eq('the Monitors list carries the address', `${listed?.street_address}|${listed?.home_address}`, '9 Oak Ave|9 Oak Ave, Salem, MA 01970');

      console.log('\n--- address: the monitor edits their own ---');
      const mine = await api('GET', '/users/me', tSam);
      eq('/users/me shows the monitor their address', mine.body?.home_address, '9 Oak Ave, Salem, MA 01970');
      const self = await api('PATCH', '/users/me', tSam, { street_address: '22 Birch Ln', city: 'Peabody', state: 'MA', zip_code: '01960' });
      eq('monitor edits own address -> 200', self.status, 200);
      eq('own address saved', self.body?.home_address, '22 Birch Ln, Peabody, MA 01960');
      eq('monitor sends a bad zip -> 400', (await api('PATCH', '/users/me', tSam, { street_address: '1 A', city: 'B', state: 'MA', zip_code: 'abc' })).status, 400);
      eq('a parent cannot send street_address on /users/me -> 400', (await api('PATCH', '/users/me', tParent, addr)).status, 400);
      eq('a driver cannot send street_address on /users/me -> 400', (await api('PATCH', '/users/me', tDriver, addr)).status, 400);

      console.log('\n--- driver sees the monitor on the run ---');
      const none = await api('GET', '/schedule/monitors', tDriver);
      eq('no monitor assigned -> 200', none.status, 200);
      eq('no monitor assigned -> empty morning and afternoon', `${none.body?.morning?.length} ${none.body?.afternoon?.length}`, '0 0');

      eq('assign Sam: every day, mornings only', (await api('PUT', `/monitors/${sam.id}/assignment`, tA, { driver_user_id: driver.id, days_of_week: [1, 2, 3, 4, 5, 6, 7], shift_period: 'morning' })).status, 200);
      const today = (await api('GET', '/schedule/monitors', tDriver)).body;
      eq('morning run shows Sam', names(today.morning), 'Sam Monitor');
      eq('afternoon run shows nobody (mornings only)', today.afternoon.length, 0);
      const m = today.morning[0];
      eq('driver sees the monitor\'s name, phone and address', `${m.full_name}|${m.phone}|${m.address}`, 'Sam Monitor|555-0201|22 Birch Ln, Peabody, MA 01960');
      eq('only those four fields (no email etc.)', Object.keys(m).sort().join(','), 'address,full_name,id,phone');
      eq('another driver in the same company sees nobody', names((await api('GET', '/schedule/monitors', tLonely)).body.morning), '');
      eq('another company\'s driver sees nobody', names((await api('GET', '/schedule/monitors', tDriverB)).body.morning), '');
      eq('a monitor cannot open /schedule/monitors -> 403', (await api('GET', '/schedule/monitors', tSam)).status, 403);
      eq('an admin cannot open /schedule/monitors -> 403 (driver screen)', (await api('GET', '/schedule/monitors', tA)).status, 403);

      // Gina rides 'both' on Monday + Wednesday only; then she is deactivated.
      await api('PUT', `/monitors/${gone.id}/assignment`, tA, { driver_user_id: driver.id, days_of_week: [1, 3], shift_period: 'both' });
      // Bea (company B) can't be attached to company A's driver; write it straight in as a DB-level
      // probe that even a bad row never leaks across companies.
      await pool.query("INSERT INTO monitor_assignments(company_id,monitor_user_id,driver_user_id,days_of_week,shift_period) VALUES($1,$2,$3,'{1,2,3,4,5,6,7}','both')", [B.id, monB.id, driverB.id]);

      const week = (await api('GET', '/schedule/week?start=2026-10-05', tDriver)).body; // Mon 5 Oct 2026
      const day = (date) => week.days.find((d) => d.date === date);
      eq('Monday morning: Gina and Sam (sorted by name)', names(day('2026-10-05').monitors.morning), 'Gina Gone,Sam Monitor');
      eq('Monday afternoon: Gina only', names(day('2026-10-05').monitors.afternoon), 'Gina Gone');
      eq('Tuesday morning: Sam only (Gina rides Mon/Wed)', names(day('2026-10-06').monitors.morning), 'Sam Monitor');
      eq('Tuesday afternoon: nobody', day('2026-10-06').monitors.afternoon.length, 0);
      eq('Wednesday afternoon: Gina', names(day('2026-10-07').monitors.afternoon), 'Gina Gone');
      eq('week students still listed as before', day('2026-10-05').morning.length, 1);
      eq('company B driver week: only Bea, never company A monitors', names((await api('GET', '/schedule/week?start=2026-10-05', tDriverB)).body.days[0].monitors.morning), 'Bea Monitor');

      await pool.query('UPDATE users SET is_active = false WHERE id = $1', [gone.id]);
      const after = (await api('GET', '/schedule/week?start=2026-10-05', tDriver)).body;
      eq('a deactivated monitor no longer shows on the run', names(after.days[0].monitors.afternoon), '');

      eq('unassign Sam -> 204', (await api('DELETE', `/monitors/${sam.id}/assignment`, tA)).status, 204);
      const cleared = (await api('GET', '/schedule/monitors', tDriver)).body;
      eq('after unassigning, the driver sees nobody', `${cleared.morning.length} ${cleared.afternoon.length}`, '0 0');

      console.log('\n--- monitor sees the driver ---');
      await api('PUT', `/monitors/${sam.id}/assignment`, tA, { driver_user_id: driver.id, days_of_week: [1, 2, 3, 4, 5, 6, 7], shift_period: 'both' });
      const home = (await api('GET', '/monitor/me', tSam)).body;
      eq('monitor sees the driver\'s name and phone', `${home.driver?.full_name}|${home.driver?.phone}`, 'Dana Driver|555-0101');
      eq('monitor sees the van (number, plate)', `${home.van?.number}|${home.van?.license_plate}`, '12|VAN-44');
      ok(!/Kid One|Elm St/.test(JSON.stringify(home)) ? 'still no student data for the monitor' : 'student data leaked to the monitor');

      console.log('\n--- address removal ---');
      const removed = await api('PATCH', '/users/me', tSam, { street_address: null, city: '', state: null, zip_code: null });
      eq('all four empty removes the address -> 200', `${removed.status} ${removed.body?.home_address}`, '200 null');
      eq('driver then sees the monitor with no address', (await api('GET', '/schedule/monitors', tDriver)).body.morning[0]?.address, null);
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
