// Step 3 (resources) — placeholder-creation + Vans/Students/Users/Sessions/Assignments/PayRules.
const PG_PORT = 5453;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-04';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('04-resources');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:4400';
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
  const epg = await startEmbeddedPostgres('04-resources', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const B = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    await ins("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('a@co.com',$1,'Admin A','company_admin',$2,now()) RETURNING id", [hash, A.id]);
    await ins("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('b@co.com',$1,'Admin B','company_admin',$2,now()) RETURNING id", [hash, B.id]);
    await ins("INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('sa@sch.com',$1,'School Admin','school_admin',$2,now()) RETURNING id", [hash, S.id]);

    const app = createApp();
    const server = app.listen(4400);
    try {
      const adminA = await login('a@co.com');
      const adminB = await login('b@co.com');
      const schoolAdmin = await login('sa@sch.com');

      console.log('--- Placeholder creation (role/side gated) ---');
      const ph = await api('POST', '/placeholders/school', adminA, { name: 'Maple Elementary', address: '1 Rd' });
      (ph.status === 201 && ph.body.claim_status === 'unclaimed') ? ok('company_admin creates school placeholder (unclaimed)') : bad(`ph create: ${ph.status}`);
      eq('school_admin creates company placeholder -> 201', (await api('POST', '/placeholders/company', schoolAdmin, { name: 'Acme Bus', address: '1 Bus Way' })).status, 201);
      eq('company_admin creating a company placeholder -> 403 (wrong side)', (await api('POST', '/placeholders/company', adminA, { name: 'x', address: 'y' })).status, 403);
      eq('placeholder missing address -> 400 (now required)', (await api('POST', '/placeholders/company', schoolAdmin, { name: 'No Address Co' })).status, 400);

      console.log('\n--- Users ---');
      const driverBasics = { phone: '555-0100', address: '1 Main St', licenseNumber: 'D0000001' };
      const mk = await api('POST', '/users', adminA, { role: 'driver', email: 'drvA@co.com', fullName: 'Driver A', password: PW, ...driverBasics });
      (mk.status === 201 && mk.body.email_verified_at) ? ok('company_admin creates driver, email_verified stamped (invariant)') : bad(`user create: ${mk.status} ${JSON.stringify(mk.body)}`);
      const driverAId = mk.body.id;
      eq('company_admin creating a school_staff -> 403 (cross-side role)', (await api('POST', '/users', adminA, { role: 'school_staff', email: 'x@x.com', fullName: 'x', password: PW })).status, 403);
      eq('school_admin creating a driver -> 403 (cross-side role, reverse direction, BACKLOG #3)', (await api('POST', '/users', schoolAdmin, { role: 'driver', email: 'y@y.com', fullName: 'y', password: PW, ...driverBasics })).status, 403);
      eq('driver create missing phone -> 400 (now required)', (await api('POST', '/users', adminA, { role: 'driver', email: 'nophone@co.com', fullName: 'No Phone', password: PW, address: '1 St', licenseNumber: 'D1' })).status, 400);
      eq('duplicate email -> 409', (await api('POST', '/users', adminA, { role: 'driver', email: 'drvA@co.com', fullName: 'dup', password: PW, ...driverBasics })).status, 409);
      const drvB = await api('POST', '/users', adminB, { role: 'driver', email: 'drvB@co.com', fullName: 'Driver B', password: PW, ...driverBasics });
      const driverBId = drvB.body.id;
      const listA = await api('GET', '/users', adminA);
      listA.body.every((u) => u.email !== 'drvB@co.com') ? ok('admin A user list excludes Company B users (isolation)') : bad('admin A saw a Company B user');
      eq('admin A GET Company B user by id -> 404 (no cross-tenant)', (await api('GET', `/users/${driverBId}`, adminA)).status, 404);
      const driverA = await login('drvA@co.com');
      eq('driver GET /users -> 403 (not an admin)', (await api('GET', '/users', driverA)).status, 403);

      const mkWithFields = await api('POST', '/users', adminA, {
        role: 'driver', email: 'drvC@co.com', fullName: 'Driver C', password: PW,
        phone: '555-0102', address: '9 Oak St', licenseNumber: 'D1234567',
      });
      (mkWithFields.status === 201 && mkWithFields.body.address === '9 Oak St' && mkWithFields.body.license_number === 'D1234567')
        ? ok('driver create accepts address/licenseNumber') : bad(`driver create fields: ${JSON.stringify(mkWithFields.body)}`);
      const editFields = await api('PATCH', `/users/${mkWithFields.body.id}`, adminA, { address: '10 Pine St', license_number: 'D7654321' });
      (editFields.body.address === '10 Pine St' && editFields.body.license_number === 'D7654321')
        ? ok('driver edit updates address/license_number') : bad(`driver edit fields: ${JSON.stringify(editFields.body)}`);

      console.log('\n--- Vans ---');
      const vanFields = { brand: 'Ford', model: 'Transit', year: 2022, color: 'White' };
      const vanA = (await api('POST', '/vans', adminA, { license_plate: 'AAA-1', ...vanFields })).body;
      const vanB = (await api('POST', '/vans', adminB, { license_plate: 'BBB-1', ...vanFields })).body;
      const vansA = await api('GET', '/vans', adminA);
      (vansA.body.length === 1 && vansA.body[0].id === vanA.id) ? ok('admin A sees only Company A vans') : bad('van isolation broke');
      eq('school_admin GET /vans -> 403 (structural: no van scope)', (await api('GET', '/vans', schoolAdmin)).status, 403);
      (vanA.brand === 'Ford' && vanA.model === 'Transit' && vanA.color === 'White' && vanA.driver_user_id === undefined)
        ? ok('van create returns brand/model/color (no standalone driver_user_id field)') : bad(`van create fields: ${JSON.stringify(vanA)}`);
      eq(
        'van create missing color -> 400 (now required)',
        (await api('POST', '/vans', adminA, { license_plate: 'CCC-1', brand: 'Ford', model: 'Transit', year: 2022 })).status,
        400
      );

      console.log('\n--- Students (dual-tenant) ---');
      const studentFields = {
        grade: '3', age: 8, parent_name: 'Pat Guardian', parent_phone: '555-1000',
        street_address: '5 Elm St', city: 'Boston', state: 'ma', zip_code: '02139', notes: 'None',
      };
      const stu = await api('POST', '/students', adminA, { full_name: 'Kid One', school_id: S.id, ...studentFields });
      stu.status === 201 && stu.body.company_id === A.id && stu.body.school_id === S.id ? ok('company_admin creates student (company stamped, school linked)') : bad(`student create: ${stu.status}`);
      stu.body.state === 'MA' ? ok('student state normalized to uppercase') : bad(`student state: ${stu.body.state}`);
      eq(
        'student create missing parent_phone -> 400 (now required)',
        (await api('POST', '/students', adminA, { full_name: 'x', school_id: S.id, ...studentFields, parent_phone: undefined })).status,
        400
      );
      eq('student with bogus school_id -> 400 (FK)', (await api('POST', '/students', adminA, { full_name: 'x', school_id: '00000000-0000-0000-0000-000000000000', ...studentFields })).status, 400);
      eq(
        'student create missing notes -> 400 (§7 item 6: no more optional fields)',
        (await api('POST', '/students', adminA, { full_name: 'x', school_id: S.id, ...studentFields, notes: undefined })).status,
        400
      );

      // Rework (2026-08-27, later): students no longer have a standalone driver_user_id
      // field at all — sending one is simply ignored (not a validation error), since "which
      // driver" is now derived from the real assignments table, not written here.
      const stuIgnoresDriverField = await api('POST', '/students', adminA, {
        full_name: 'Kid Ignored Driver Field', school_id: S.id, ...studentFields, driver_user_id: driverAId,
      });
      (stuIgnoresDriverField.status === 201 && stuIgnoresDriverField.body.driver_user_id === undefined)
        ? ok('student create silently ignores a driver_user_id in the body (no such column anymore)')
        : bad(`student w/ driver field: ${JSON.stringify(stuIgnoresDriverField.body)}`);
      const schoolView = await api('GET', '/students', schoolAdmin);
      schoolView.body.some((s) => s.id === stu.body.id) ? ok('school_admin sees the student via school scope (cross-side read)') : bad('school_admin cannot see its student');
      (await api('GET', '/students', adminB)).body.length === 0 ? ok('admin B sees no Company A students (isolation)') : bad('student leaked to Company B');

      console.log('\n--- Students: age/street address/notes + contacts (Driver dashboard rework) ---');
      const stu2 = await api('POST', '/students', adminA, {
        full_name: 'Kid Two', school_id: S.id, ...studentFields, age: 8, notes: 'needs help buckling',
      });
      (stu2.status === 201 && stu2.body.age === 8 && stu2.body.street_address === '5 Elm St' && stu2.body.city === 'Boston' && stu2.body.notes === 'needs help buckling')
        ? ok('student create accepts age/street_address/city/notes') : bad(`student create w/ new fields: ${stu2.status} ${JSON.stringify(stu2.body)}`);
      const patchStu = await api('PATCH', `/students/${stu2.body.id}`, adminA, { age: 9 });
      patchStu.body.age === 9 ? ok('student patch updates age') : bad(`patch age: ${JSON.stringify(patchStu.body)}`);

      const contact1 = await api('POST', `/students/${stu2.body.id}/contacts`, adminA, { name: 'Grandma Jo', phone: '555-2222', relationship: 'Grandmother' });
      eq('company_admin adds a student contact -> 201', contact1.status, 201);
      const stuWithContacts = await api('GET', `/students/${stu2.body.id}`, adminA);
      (Array.isArray(stuWithContacts.body.contacts) && stuWithContacts.body.contacts.length === 1 && stuWithContacts.body.contacts[0].name === 'Grandma Jo')
        ? ok('GET student includes contacts array') : bad(`contacts not merged: ${JSON.stringify(stuWithContacts.body)}`);
      const driverATokenEarly = await login('drvA@co.com');
      eq('driver creating a contact -> 403 (company_admin only)', (await api('POST', `/students/${stu2.body.id}/contacts`, driverATokenEarly, { name: 'x' })).status, 403);
      eq('delete contact -> 204', (await api('DELETE', `/students/${stu2.body.id}/contacts/${contact1.body.id}`, adminA)).status, 204);
      const afterDelete = await api('GET', `/students/${stu2.body.id}`, adminA);
      afterDelete.body.contacts.length === 0 ? ok('contact removed after delete') : bad('contact still present after delete');

      console.log('\n--- Schools (cross-tenant read, company_admin only, BACKLOG #7) ---');
      const schoolsA = await api('GET', '/schools', adminA);
      (schoolsA.status === 200 && schoolsA.body.length === 1 && schoolsA.body[0].id === S.id && schoolsA.body[0].name === 'School S')
        ? ok('company_admin sees the name of a school it has a student at') : bad(`schools A: ${schoolsA.status} ${JSON.stringify(schoolsA.body)}`);
      (await api('GET', '/schools', adminB)).body.length === 0 ? ok('admin B (no students anywhere) sees no schools') : bad('school leaked to Company B with no relationship');
      const driverATokenEarly2 = await login('drvA@co.com');
      eq('school_admin GET /schools -> 403 (company_admin only)', (await api('GET', '/schools', schoolAdmin)).status, 403);
      eq('driver GET /schools -> 403 (company_admin only)', (await api('GET', '/schools', driverATokenEarly2)).status, 403);
      eq('unauthenticated GET /schools -> 401', (await api('GET', '/schools', null)).status, 401);

      console.log('\n--- Schools: /me profile + /:id detail (Driver dashboard rework) ---');
      const meGet = await api('GET', '/schools/me', schoolAdmin);
      (meGet.status === 200 && meGet.body.id === S.id) ? ok('school_admin GET /schools/me returns own school') : bad(`schools/me get: ${meGet.status}`);
      eq('company_admin GET /schools/me -> 403 (school_admin only)', (await api('GET', '/schools/me', adminA)).status, 403);
      const mePatch = await api('PATCH', '/schools/me', schoolAdmin, {
        phone: '555-3333', hours: 'Mon-Fri 8am-4pm', website: 'https://school-s.example.edu', zip_code: '02139', state: 'ma',
      });
      (mePatch.status === 200 && mePatch.body.phone === '555-3333' && mePatch.body.state === 'MA')
        ? ok('school_admin PATCH /schools/me updates profile fields, state normalized') : bad(`schools/me patch: ${mePatch.status} ${JSON.stringify(mePatch.body)}`);
      eq('PATCH /schools/me with bad zip -> 400', (await api('PATCH', '/schools/me', schoolAdmin, { zip_code: 'bad' })).status, 400);

      const schoolDetail = await api('GET', `/schools/${S.id}`, adminA);
      (schoolDetail.status === 200 && schoolDetail.body.phone === '555-3333') ? ok('company_admin GET /schools/:id sees full detail incl. phone') : bad(`schools/:id: ${schoolDetail.status}`);
      const schoolDetailDriver = await api('GET', `/schools/${S.id}`, driverATokenEarly2);
      schoolDetailDriver.status === 200 ? ok('driver GET /schools/:id sees a school their company has a student at') : bad(`driver schools/:id: ${schoolDetailDriver.status}`);
      eq('admin B GET /schools/:id (no relationship) -> 404', (await api('GET', `/schools/${S.id}`, adminB)).status, 404);

      console.log('\n--- Sessions (driver shifts) ---');
      const ci = await api('POST', '/sessions/checkin', driverA, { check_in_lat: 42.3, check_in_lng: -71.1 });
      ci.status === 201 ? ok('driver check-in -> 201') : bad(`checkin ${ci.status}`);
      eq('second check-in with open shift -> 409', (await api('POST', '/sessions/checkin', driverA, {})).status, 409);
      const co = await api('POST', `/sessions/${ci.body.id}/checkout`, driverA, {});
      (co.status === 200 && co.body.check_out_at && typeof co.body.duration_minutes === 'number') ? ok('checkout closes shift + computes duration_minutes') : bad(`checkout ${co.status}`);
      const driverB = await login('drvB@co.com');
      eq('driver B checkout of driver A session -> 404 (owner scope)', (await api('POST', `/sessions/${ci.body.id}/checkout`, driverB, {})).status, 404);
      const adminSees = await api('GET', '/sessions', adminA);
      adminSees.body.length === 1 ? ok('company_admin sees company shifts') : bad(`admin sessions ${adminSees.body.length}`);

      console.log('\n--- Assignments (composite-FK tenant integrity) ---');
      const asg = await api('POST', '/assignments', adminA, { student_id: stu.body.id, driver_user_id: driverAId, van_id: vanA.id, start_date: '2026-07-01' });
      eq('company_admin creates assignment -> 201', asg.status, 201);
      eq('assignment using Company B van -> 400 (cross-company FK)', (await api('POST', '/assignments', adminA, { student_id: stu.body.id, driver_user_id: driverAId, van_id: vanB.id, start_date: '2026-07-01' })).status, 400);
      const drvAsg = await api('GET', '/assignments', driverA);
      drvAsg.body.length === 1 ? ok('driver sees own assignment (owner sub-scope)') : bad(`driver assignments ${drvAsg.body.length}`);
      (await api('GET', '/assignments', adminB)).body.length === 0 ? ok('admin B sees no Company A assignments (isolation)') : bad('assignment leaked');
      eq('delete assignment -> 204', (await api('DELETE', `/assignments/${asg.body.id}`, adminA)).status, 204);

      console.log('\n--- Assignments: pickup_time/dropoff_time (Driver dashboard rework) ---');
      const asg2 = await api('POST', '/assignments', adminA, {
        student_id: stu.body.id, driver_user_id: driverAId, van_id: vanA.id, start_date: '2020-01-01',
        pickup_time: '07:30', dropoff_time: '15:00',
      });
      (asg2.status === 201 && asg2.body.pickup_time && asg2.body.dropoff_time)
        ? ok('assignment create accepts pickup_time/dropoff_time') : bad(`asg2 create: ${asg2.status} ${JSON.stringify(asg2.body)}`);
      eq('assignment create with bad time -> 400', (await api('POST', '/assignments', adminA, {
        student_id: stu.body.id, driver_user_id: driverAId, van_id: vanA.id, start_date: '2026-07-01', pickup_time: 'nope',
      })).status, 400);
      const patchTime = await api('PATCH', `/assignments/${asg2.body.id}`, adminA, { pickup_time: '08:00' });
      eq('assignment patch updates pickup_time -> 200', patchTime.status, 200);

      console.log('\n--- Assignments: real conflict enforcement (open-ended asg2 = driverA/vanA/stu, from 2020-01-01) ---');
      const vanA2 = (await api('POST', '/vans', adminA, { license_plate: 'AAA-2', ...vanFields })).body;
      const driverCId = mkWithFields.body.id;
      eq(
        'same driver+van, different student, overlapping dates -> 201 (normal multi-student route, not a conflict)',
        (await api('POST', '/assignments', adminA, { student_id: stu2.body.id, driver_user_id: driverAId, van_id: vanA.id, start_date: '2026-07-01' })).status,
        201
      );
      eq(
        'different driver, same van, overlapping dates -> 409 (van already has a different driver)',
        (await api('POST', '/assignments', adminA, { student_id: stu2.body.id, driver_user_id: driverCId, van_id: vanA.id, start_date: '2026-07-01' })).status,
        409
      );
      eq(
        'different driver, same student, overlapping dates -> 409 (student already has a different driver)',
        (await api('POST', '/assignments', adminA, { student_id: stu.body.id, driver_user_id: driverCId, van_id: vanA2.id, start_date: '2026-07-01' })).status,
        409
      );
      eq(
        'same driver, different van, overlapping dates -> 409 (driver already driving a different van)',
        (await api('POST', '/assignments', adminA, { student_id: stu2.body.id, driver_user_id: driverAId, van_id: vanA2.id, start_date: '2026-07-01' })).status,
        409
      );
      const nonOverlapping = await api('POST', '/assignments', adminA, {
        student_id: stu.body.id, driver_user_id: driverCId, van_id: vanA2.id, start_date: '2010-01-01', end_date: '2010-06-01',
      });
      eq('different driver+van but a date range before asg2 even starts -> 201 (no overlap, no conflict)', nonOverlapping.status, 201);
      eq(
        'PATCH moving a van onto a driver who already drives a different van in that range -> 409',
        (await api('PATCH', `/assignments/${nonOverlapping.body.id}`, adminA, { driver_user_id: driverAId, start_date: '2026-08-01', end_date: null })).status,
        409
      );
      eq('DELETE the just-created probe assignments so they do not affect later suites', (await api('DELETE', `/assignments/${nonOverlapping.body.id}`, adminA)).status, 204);

      console.log('\n--- GET /schedule/today (no override yet) ---');
      const today1 = await api('GET', '/schedule/today', driverA);
      const row1 = today1.body.find((r) => r.assignment_id === asg2.body.id);
      (today1.status === 200 && row1 && row1.pickup_time === '08:00:00' && row1.override === null)
        ? ok("driver sees today's schedule with usual time, no override") : bad(`schedule/today: ${today1.status} ${JSON.stringify(today1.body)}`);
      eq('company_admin GET /schedule/today -> 403 (driver only)', (await api('GET', '/schedule/today', adminA)).status, 403);

      console.log('\n--- Overrides: upsert / list / resolve in schedule / delete ---');
      const todayStr = new Date().toISOString().slice(0, 10);
      const ov = await api('POST', `/assignments/${asg2.body.id}/overrides`, adminA, { override_date: todayStr, pickup_time: '09:00' });
      eq('company_admin creates an override for today -> 201', ov.status, 201);
      const todayWithOverride = await api('GET', '/schedule/today', driverA);
      const row2 = todayWithOverride.body.find((r) => r.assignment_id === asg2.body.id);
      (row2 && row2.override && row2.override.pickup_time === '09:00:00')
        ? ok("schedule/today resolves today's override pickup_time") : bad(`override not resolved: ${JSON.stringify(row2)}`);

      const ovUpdate = await api('POST', `/assignments/${asg2.body.id}/overrides`, adminA, { override_date: todayStr, skip: true, note: 'no school today' });
      eq('re-posting same date upserts (updates) rather than duplicating -> 201', ovUpdate.status, 201);
      const listOv = await api('GET', `/assignments/${asg2.body.id}/overrides`, adminA);
      listOv.body.length === 1 ? ok('upsert did not create a duplicate row for the same date') : bad(`override list has ${listOv.body.length} rows`);
      const todaySkipped = await api('GET', '/schedule/today', driverA);
      const row3 = todaySkipped.body.find((r) => r.assignment_id === asg2.body.id);
      (row3 && row3.override.skip === true && row3.override.note === 'no school today')
        ? ok('schedule/today reflects updated override (skip=true)') : bad(`skip override wrong: ${JSON.stringify(row3)}`);

      eq('driver deleting an override -> 403 (company_admin only)', (await api('DELETE', `/assignments/${asg2.body.id}/overrides/${listOv.body[0].id}`, driverA)).status, 403);
      eq('company_admin deletes override -> 204', (await api('DELETE', `/assignments/${asg2.body.id}/overrides/${listOv.body[0].id}`, adminA)).status, 204);
      const todayAfterDelete = await api('GET', '/schedule/today', driverA);
      const row4 = todayAfterDelete.body.find((r) => r.assignment_id === asg2.body.id);
      row4.override === null ? ok('override gone after delete, back to usual time') : bad('override still present after delete');

      eq('admin B cannot add an override to a Company A assignment -> 404', (await api('POST', `/assignments/${asg2.body.id}/overrides`, adminB, { override_date: todayStr })).status, 404);

      console.log('\n--- PayRules + summary (integer cents) ---');
      eq('upsert hourly rule 1850 -> 200', (await api('PUT', `/payroll/rules/${driverAId}`, adminA, { rate_type: 'hourly', rate_cents: 1850 })).status, 200);
      eq('re-upsert (daily) same driver -> 200 (no dup)', (await api('PUT', `/payroll/rules/${driverAId}`, adminA, { rate_type: 'hourly', rate_cents: 1850 })).status, 200);
      // Seed a completed 120-minute shift so hourly math is non-trivial.
      await pool.query("INSERT INTO sessions(user_id,company_id,check_in_at,check_out_at,duration_minutes) VALUES($1,$2,now()-interval '2 hours',now(),120)", [driverAId, A.id]);
      await api('POST', '/payroll/adjustments', adminA, { driver_id: driverAId, amount_cents: 5000, note: 'covered a shift', work_date: '2026-07-02' });
      const sum = await api('GET', `/payroll/summary/${driverAId}`, adminA);
      // base = round(120/60 * 1850) = 3700 ; +5000 adjustment = 8700
      (sum.body.base_pay_cents === 3700 && sum.body.adjustments_cents === 5000 && sum.body.total_pay_cents === 8700)
        ? ok('summary = hours*rate + adjustments (3700 + 5000 = 8700)') : bad(`summary wrong: ${JSON.stringify(sum.body)}`);
      eq('driver reads own summary -> 200', (await api('GET', `/payroll/summary/${driverAId}`, driverA)).status, 200);
      eq('driver reads another driver summary -> 403', (await api('GET', `/payroll/summary/${driverBId}`, driverA)).status, 403);
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
