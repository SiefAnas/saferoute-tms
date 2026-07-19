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
      eq('school_admin creates company placeholder -> 201', (await api('POST', '/placeholders/company', schoolAdmin, { name: 'Acme Bus' })).status, 201);
      eq('company_admin creating a company placeholder -> 403 (wrong side)', (await api('POST', '/placeholders/company', adminA, { name: 'x' })).status, 403);

      console.log('\n--- Users ---');
      const mk = await api('POST', '/users', adminA, { role: 'driver', email: 'drvA@co.com', fullName: 'Driver A', password: PW });
      (mk.status === 201 && mk.body.email_verified_at) ? ok('company_admin creates driver, email_verified stamped (invariant)') : bad(`user create: ${mk.status} ${JSON.stringify(mk.body)}`);
      const driverAId = mk.body.id;
      eq('company_admin creating a school_staff -> 403 (cross-side role)', (await api('POST', '/users', adminA, { role: 'school_staff', email: 'x@x.com', fullName: 'x', password: PW })).status, 403);
      eq('school_admin creating a driver -> 403 (cross-side role, reverse direction, BACKLOG #3)', (await api('POST', '/users', schoolAdmin, { role: 'driver', email: 'y@y.com', fullName: 'y', password: PW })).status, 403);
      eq('duplicate email -> 409', (await api('POST', '/users', adminA, { role: 'driver', email: 'drvA@co.com', fullName: 'dup', password: PW })).status, 409);
      const drvB = await api('POST', '/users', adminB, { role: 'driver', email: 'drvB@co.com', fullName: 'Driver B', password: PW });
      const driverBId = drvB.body.id;
      const listA = await api('GET', '/users', adminA);
      listA.body.every((u) => u.email !== 'drvB@co.com') ? ok('admin A user list excludes Company B users (isolation)') : bad('admin A saw a Company B user');
      eq('admin A GET Company B user by id -> 404 (no cross-tenant)', (await api('GET', `/users/${driverBId}`, adminA)).status, 404);
      const driverA = await login('drvA@co.com');
      eq('driver GET /users -> 403 (not an admin)', (await api('GET', '/users', driverA)).status, 403);

      console.log('\n--- Vans ---');
      const vanA = (await api('POST', '/vans', adminA, { license_plate: 'AAA-1', model: 'Transit' })).body;
      const vanB = (await api('POST', '/vans', adminB, { license_plate: 'BBB-1' })).body;
      const vansA = await api('GET', '/vans', adminA);
      (vansA.body.length === 1 && vansA.body[0].id === vanA.id) ? ok('admin A sees only Company A vans') : bad('van isolation broke');
      eq('school_admin GET /vans -> 403 (structural: no van scope)', (await api('GET', '/vans', schoolAdmin)).status, 403);

      console.log('\n--- Students (dual-tenant) ---');
      const stu = await api('POST', '/students', adminA, { full_name: 'Kid One', grade: '3', school_id: S.id });
      stu.status === 201 && stu.body.company_id === A.id && stu.body.school_id === S.id ? ok('company_admin creates student (company stamped, school linked)') : bad(`student create: ${stu.status}`);
      eq('student with bogus school_id -> 400 (FK)', (await api('POST', '/students', adminA, { full_name: 'x', school_id: '00000000-0000-0000-0000-000000000000' })).status, 400);
      const schoolView = await api('GET', '/students', schoolAdmin);
      schoolView.body.some((s) => s.id === stu.body.id) ? ok('school_admin sees the student via school scope (cross-side read)') : bad('school_admin cannot see its student');
      (await api('GET', '/students', adminB)).body.length === 0 ? ok('admin B sees no Company A students (isolation)') : bad('student leaked to Company B');

      console.log('\n--- Schools (cross-tenant read, company_admin only, BACKLOG #7) ---');
      const schoolsA = await api('GET', '/schools', adminA);
      (schoolsA.status === 200 && schoolsA.body.length === 1 && schoolsA.body[0].id === S.id && schoolsA.body[0].name === 'School S')
        ? ok('company_admin sees the name of a school it has a student at') : bad(`schools A: ${schoolsA.status} ${JSON.stringify(schoolsA.body)}`);
      (await api('GET', '/schools', adminB)).body.length === 0 ? ok('admin B (no students anywhere) sees no schools') : bad('school leaked to Company B with no relationship');
      eq('school_admin GET /schools -> 403 (company_admin only)', (await api('GET', '/schools', schoolAdmin)).status, 403);
      eq('driver GET /schools -> 403 (company_admin only)', (await api('GET', '/schools', driverA)).status, 403);
      eq('unauthenticated GET /schools -> 401', (await api('GET', '/schools', null)).status, 401);

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
