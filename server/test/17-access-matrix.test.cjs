// Access matrix: every role sees only the students it deals with (ACCESS_SCOPE_REPORT.md).
// For every role: a list, a get by id, and at least one response that embeds student data.
// Out-of-scope get-by-id must be 404 (never 403, so an id's existence isn't confirmed).
//
//   company_admin -> own company's students        school_admin -> own school's students
//   school_staff  -> granted students only         parent -> linked children, /parent/* only
//   driver        -> students on own assignments that have not ended (today or future)
//   monitor       -> no students at all: own shifts/pay, the driver's name + phone, the van
const PG_PORT = 5467;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-17';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('17-access-matrix');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5700';
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
const ids = (rows) => (Array.isArray(rows) ? rows.map((r) => r.id).sort() : rows);
const sameSet = (label, actual, expected) => {
  const a = JSON.stringify([...actual].sort());
  const e = JSON.stringify([...expected].sort());
  a === e ? ok(label) : bad(`${label}\n      got      ${a}\n      expected ${e}`);
};

async function main() {
  const epg = await startEmbeddedPostgres('17-access-matrix', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const B = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id");
    const S1 = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School One','claimed',now()) RETURNING id");
    const S2 = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School Two','claimed',now()) RETURNING id");
    const user = (email, role, col, id) => ins(
      `INSERT INTO users(email,password_hash,full_name,role,${col},email_verified_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id`,
      [email, hash, email.split('@')[0], role, id]
    );
    const adminA = await user('admin@a.com', 'company_admin', 'company_id', A.id);
    await user('admin@b.com', 'company_admin', 'company_id', B.id);
    await user('sa1@s1.com', 'school_admin', 'school_id', S1.id);
    await user('sa2@s2.com', 'school_admin', 'school_id', S2.id);
    const staff = await user('staff@s1.com', 'school_staff', 'school_id', S1.id);
    const dA = await user('da@a.com', 'driver', 'company_id', A.id);
    const dB = await user('db@a.com', 'driver', 'company_id', A.id);
    const dC = await user('dc@b.com', 'driver', 'company_id', B.id);
    const parent = await user('parent@a.com', 'parent', 'company_id', A.id);
    const monitor = await user('mon@a.com', 'monitor', 'company_id', A.id);

    const student = (company, school, name) =>
      ins('INSERT INTO students(company_id,school_id,full_name,street_address) VALUES($1,$2,$3,$4) RETURNING id', [company, school, name, `${name} home`]);
    const sMine = await student(A.id, S1.id, 'A Mine');       // dA, active
    const sOther = await student(A.id, S1.id, 'A Other');     // dB, active
    const sEnded = await student(A.id, S2.id, 'A Ended');     // dA, ended assignment
    const sFuture = await student(A.id, S1.id, 'A Future');   // dA, starts in the future
    const sNone = await student(A.id, S1.id, 'A None');       // nobody's
    const sB = await student(B.id, S1.id, 'B Kid');           // company B, dC

    const van = (company, plate) => ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,$2,'Ford','Transit',2022) RETURNING id", [company, plate]);
    const vMine = await van(A.id, 'MINE-1');
    const vOther = await van(A.id, 'OTHER-1');
    const vEnded = await van(A.id, 'ENDED-1');
    const vFuture = await van(A.id, 'FUTURE-1');
    const vB = await van(B.id, 'B-1');

    const assign = (company, stu, drv, v, start, end) => ins(
      "INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,end_date,days_of_week) VALUES($1,$2,$3,$4,$5,$6,'{1,2,3,4,5,6,7}') RETURNING id",
      [company, stu.id, drv.id, v.id, start, end]
    );
    const aMine = await assign(A.id, sMine, dA, vMine, '2020-01-01', null);
    const aOther = await assign(A.id, sOther, dB, vOther, '2020-01-01', null);
    const aEnded = await assign(A.id, sEnded, dA, vEnded, '2020-01-01', '2020-12-31');
    const aFuture = await assign(A.id, sFuture, dA, vFuture, '2099-01-01', null);
    await assign(B.id, sB, dC, vB, '2020-01-01', null);

    await ins('INSERT INTO parent_students(parent_user_id,student_id,company_id) VALUES($1,$2,$3) RETURNING id', [parent.id, sMine.id, A.id]);
    await ins('INSERT INTO monitor_assignments(company_id,monitor_user_id,driver_user_id) VALUES($1,$2,$3) RETURNING id', [A.id, monitor.id, dA.id]);
    await ins('INSERT INTO staff_student_access(staff_user_id,student_id,school_id) VALUES($1,$2,$3) RETURNING id', [staff.id, sMine.id, S1.id]);

    const app = createApp();
    const server = app.listen(5700);
    try {
      const t = {
        adminA: await login('admin@a.com'), adminB: await login('admin@b.com'),
        sa1: await login('sa1@s1.com'), sa2: await login('sa2@s2.com'), staff: await login('staff@s1.com'),
        dA: await login('da@a.com'), dB: await login('db@a.com'), dC: await login('dc@b.com'), parent: await login('parent@a.com'), monitor: await login('mon@a.com'),
      };

      // Trips to look at later (embedded student ids): dA logs sMine, dB logs sOther, dC logs sB.
      for (const tok of [t.dA, t.dB, t.dC]) await api('POST', '/sessions/checkin', tok, { shift_period: 'morning' });

      console.log('--- driver writes: only own students, only today ---');
      const tripMine = await api('POST', '/trips', t.dA, { student_id: sMine.id, trip_type: 'pickup', shift_period: 'morning' });
      eq('driver A logs a trip for own student -> 201', tripMine.status, 201);
      eq("driver A logs a trip for driver B's student -> 404", (await api('POST', '/trips', t.dA, { student_id: sOther.id, trip_type: 'pickup', shift_period: 'morning' })).status, 404);
      eq("driver A logs a trip for an ended assignment's student -> 404", (await api('POST', '/trips', t.dA, { student_id: sEnded.id, trip_type: 'pickup', shift_period: 'morning' })).status, 404);
      eq('driver A logs a trip for an unassigned student -> 404', (await api('POST', '/trips', t.dA, { student_id: sNone.id, trip_type: 'pickup', shift_period: 'morning' })).status, 404);
      eq('driver A logs a trip for a future-only student -> 409 (visible, but not on today\'s run)', (await api('POST', '/trips', t.dA, { student_id: sFuture.id, trip_type: 'pickup', shift_period: 'morning' })).status, 409);
      eq('driver A logs a trip for another company\'s student -> 404', (await api('POST', '/trips', t.dA, { student_id: sB.id, trip_type: 'pickup', shift_period: 'morning' })).status, 404);
      const tripOther = await api('POST', '/trips', t.dB, { student_id: sOther.id, trip_type: 'pickup', shift_period: 'morning' });
      eq('driver B logs a trip for own student -> 201', tripOther.status, 201);
      const tripB = await api('POST', '/trips', t.dC, { student_id: sB.id, trip_type: 'pickup', shift_period: 'morning' });
      eq('driver C (company B) logs a trip for own student -> 201', tripB.status, 201);

      eq("driver A no-show on driver B's assignment -> 404", (await api('POST', `/schedule/${aOther.id}/no-show`, t.dA, { shift_period: 'morning' })).status, 404);
      eq('driver A no-show on own ended assignment -> 404', (await api('POST', `/schedule/${aEnded.id}/no-show`, t.dA, { shift_period: 'morning' })).status, 404);
      eq('driver A no-show on own future assignment -> 409', (await api('POST', `/schedule/${aFuture.id}/no-show`, t.dA, { shift_period: 'morning' })).status, 409);
      const noShowOther = (await pool.query('SELECT count(*)::int AS n FROM pickup_no_shows WHERE student_id = ANY($1::uuid[])', [[sOther.id, sEnded.id, sFuture.id]])).rows[0].n;
      eq('none of the refused no-shows were saved', noShowOther, 0);

      console.log('\n--- driver reads ---');
      const dStudents = await api('GET', '/students', t.dA);
      sameSet('driver A GET /students = own active + future students only', ids(dStudents.body), [sMine.id, sFuture.id]);
      eq('driver A GET /students/:id own student -> 200', (await api('GET', `/students/${sMine.id}`, t.dA)).status, 200);
      eq('driver A GET /students/:id future-assignment student -> 200', (await api('GET', `/students/${sFuture.id}`, t.dA)).status, 200);
      eq("driver A GET /students/:id driver B's student -> 404", (await api('GET', `/students/${sOther.id}`, t.dA)).status, 404);
      eq("driver A GET /students/:id ended assignment's student -> 404", (await api('GET', `/students/${sEnded.id}`, t.dA)).status, 404);
      eq('driver A GET /students/:id unassigned student -> 404', (await api('GET', `/students/${sNone.id}`, t.dA)).status, 404);
      eq('driver A GET /students/:id company B student -> 404', (await api('GET', `/students/${sB.id}`, t.dA)).status, 404);
      sameSet('driver B GET /students = only own student', ids((await api('GET', '/students', t.dB)).body), [sOther.id]);

      sameSet('driver A GET /vans = vans on own active + future assignments', ids((await api('GET', '/vans', t.dA)).body), [vMine.id, vFuture.id]);
      eq('driver A GET /vans/:id own van -> 200', (await api('GET', `/vans/${vMine.id}`, t.dA)).status, 200);
      eq("driver A GET /vans/:id driver B's van -> 404", (await api('GET', `/vans/${vOther.id}`, t.dA)).status, 404);
      eq('driver A GET /vans/:id van of an ended assignment -> 404', (await api('GET', `/vans/${vEnded.id}`, t.dA)).status, 404);

      eq('driver A GET /schools/:id school of own student -> 200', (await api('GET', `/schools/${S1.id}`, t.dA)).status, 200);
      eq('driver A GET /schools/:id school reached only via an ended assignment -> 404', (await api('GET', `/schools/${S2.id}`, t.dA)).status, 404);

      sameSet('driver A GET /assignments = own active + future (no ended)', ids((await api('GET', '/assignments', t.dA)).body), [aMine.id, aFuture.id]);
      eq('driver A GET /assignments/:id ended one -> 404', (await api('GET', `/assignments/${aEnded.id}`, t.dA)).status, 404);
      eq("driver A GET /assignments/:id driver B's -> 404", (await api('GET', `/assignments/${aOther.id}`, t.dA)).status, 404);

      const today = (await api('GET', '/schedule/today', t.dA)).body;
      sameSet('driver A /schedule/today embeds only own student running today', today.map((i) => i.student.id), [sMine.id]);
      const dTrips = (await api('GET', '/trips', t.dA)).body;
      sameSet('driver A /trips embeds only own trips\' students', dTrips.map((x) => x.student_id), [sMine.id]);
      eq("driver A GET /trips/:id driver B's trip -> 404", (await api('GET', `/trips/${tripOther.body.id}`, t.dA)).status, 404);

      console.log('\n--- company_admin ---');
      const aStudents = ids((await api('GET', '/students', t.adminA)).body);
      sameSet('company A admin GET /students = all company A students', aStudents, [sMine.id, sOther.id, sEnded.id, sFuture.id, sNone.id]);
      eq('company A admin GET /students/:id company B student -> 404', (await api('GET', `/students/${sB.id}`, t.adminA)).status, 404);
      eq('company A admin GET /students/:id own student -> 200', (await api('GET', `/students/${sEnded.id}`, t.adminA)).status, 200);
      sameSet('company A admin /trips embeds only company A students', (await api('GET', '/trips', t.adminA)).body.map((x) => x.student_id), [sMine.id, sOther.id]);
      sameSet('company B admin GET /students = only company B', ids((await api('GET', '/students', t.adminB)).body), [sB.id]);
      eq('company B admin GET /trips/:id company A trip -> 404', (await api('GET', `/trips/${tripMine.body.id}`, t.adminB)).status, 404);

      console.log('\n--- school_admin ---');
      const s1Students = (await api('GET', '/students', t.sa1)).body;
      sameSet('school 1 admin GET /students = school 1 students (both companies)', ids(s1Students), [sMine.id, sOther.id, sFuture.id, sNone.id, sB.id]);
      eq('school 1 admin GET /students/:id school 2 student -> 404', (await api('GET', `/students/${sEnded.id}`, t.sa1)).status, 404);
      sameSet('school 2 admin GET /students = only school 2', ids((await api('GET', '/students', t.sa2)).body), [sEnded.id]);
      sameSet('school 2 admin /trips embeds no school 1 students', (await api('GET', '/trips', t.sa2)).body.map((x) => x.student_id), []);

      console.log('\n--- school_staff ---');
      sameSet('staff GET /students = granted student only', ids((await api('GET', '/students', t.staff)).body), [sMine.id]);
      eq('staff GET /students/:id ungranted student -> 404', (await api('GET', `/students/${sOther.id}`, t.staff)).status, 404);
      sameSet('staff /trips embeds only the granted student', (await api('GET', '/trips', t.staff)).body.map((x) => x.student_id), [sMine.id]);
      eq('staff confirms a trip of an ungranted student -> 404', (await api('POST', `/trips/${tripOther.body.id}/confirm`, t.staff)).status, 404);
      eq('staff logs a schedule change for an ungranted student -> 404', (await api('POST', `/schedule-changes/students/${sOther.id}`, t.staff, { change_type: 'left_early' })).status, 404);
      eq('staff logs a schedule change for the granted student -> 201', (await api('POST', `/schedule-changes/students/${sMine.id}`, t.staff, { change_type: 'staying_later' })).status, 201);

      console.log('\n--- parent ---');
      sameSet('parent GET /parent/students = linked child only', ids((await api('GET', '/parent/students', t.parent)).body), [sMine.id]);
      eq('parent GET /parent/students/:id/detail own child -> 200', (await api('GET', `/parent/students/${sMine.id}/detail`, t.parent)).status, 200);
      eq('parent GET /parent/students/:id/detail other child -> 404', (await api('GET', `/parent/students/${sOther.id}/detail`, t.parent)).status, 404);
      for (const p of ['/students', `/students/${sMine.id}`, '/trips', '/assignments', '/vans', '/schedule/today']) {
        eq(`parent GET ${p} -> 403 (company routers are closed to parents)`, (await api('GET', p, t.parent)).status, 403);
      }

      console.log('\n--- monitor ---');
      const monMe = await api('GET', '/monitor/me', t.monitor);
      eq('monitor GET /monitor/me -> 200', monMe.status, 200);
      eq("monitor sees the driver's name", monMe.body.driver?.full_name, 'da');
      eq("monitor sees the van on the driver's run today", monMe.body.van?.license_plate, 'MINE-1');
      const monJson = JSON.stringify(monMe.body);
      ok(!/A Mine|A Other|home|student/i.test(monJson) ? 'monitor /monitor/me carries no student data' : `monitor /monitor/me leaks student data: ${monJson}`);
      for (const p of ['/students', `/students/${sMine.id}`, '/trips', `/trips/${tripMine.body.id}`, '/assignments', `/assignments/${aMine.id}`, '/vans', `/vans/${vMine.id}`,
        '/schedule/today', '/schedule/week', `/parent/students/${sMine.id}/detail`, '/dashboard/absent-today', '/users', '/monitors', '/payroll/rules', `/schools/${S1.id}`]) {
        eq(`monitor GET ${p} -> 403`, (await api('GET', p, t.monitor)).status, 403);
      }
      eq("monitor GET /payroll/summary of driver A -> 403", (await api('GET', `/payroll/summary/${dA.id}`, t.monitor)).status, 403);
      eq('monitor logs a trip -> 403', (await api('POST', '/trips', t.monitor, { student_id: sMine.id, trip_type: 'pickup', shift_period: 'morning' })).status, 403);
      eq('monitor no-show -> 403', (await api('POST', `/schedule/${aMine.id}/no-show`, t.monitor, { shift_period: 'morning' })).status, 403);
      const monIn = await api('POST', '/sessions/checkin', t.monitor, { shift_period: 'morning' });
      eq('monitor checks in -> 201', monIn.status, 201);
      sameSet('monitor GET /sessions = own shift only', ids((await api('GET', '/sessions', t.monitor)).body), [monIn.body.id]);
      const dASession = (await api('GET', '/sessions', t.dA)).body[0];
      eq("monitor GET /sessions/:id driver A's shift -> 404", (await api('GET', `/sessions/${dASession.id}`, t.monitor)).status, 404);
      eq("driver A GET /sessions/:id the monitor's shift -> 404", (await api('GET', `/sessions/${monIn.body.id}`, t.dA)).status, 404);
      eq("company B admin GET /monitors lists no company A monitor", (await api('GET', '/monitors', t.adminB)).body.length, 0);
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
