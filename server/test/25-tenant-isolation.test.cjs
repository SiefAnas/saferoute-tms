// Tenant isolation (docs/tenant-isolation-audit.md). Two companies and two schools, each with a
// full set of data. Every role on the A side (company A + school S1) tries to read and write
// company B's and school S2's users, students, vans, trips, sessions, assignments, payroll,
// access links, monitors, schedule changes and imports. Every attempt must fail: a non-2xx status,
// or (for list endpoints and imports, which answer 200 by design) nothing of B/S2 in the response
// and nothing written. Afterwards a snapshot of every B/S2 row must be byte-identical.
//
// The "KNOWN GAP" section at the end does NOT pass a check that isolation holds: it proves gaps
// found by the audit still exist (asserting today's behavior), so the suite stays green while they
// are open. When a gap is fixed, that section's assertions flip and must be updated (gap 1, a
// student at any school id, and gap 2, the placeholder claim takeover, are fixed and now assert
// the attack fails).
const PG_PORT = 5475;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-25';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const mailer = require('../src/mail/mailer.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('25-tenant-isolation');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5982';
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
const login = async (email) => {
  const r = await api('POST', '/auth/login', null, { email, password: PW });
  if (!r.body?.token) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
  return r.body.token;
};
const is2xx = (s) => s >= 200 && s < 300;

// Every B/S2-owned row, in a stable order. Any cross-tenant write changes this.
async function snapshotB(B, S2) {
  const q = async (sql) => (await pool.query(sql, [B, S2])).rows;
  const parts = {
    users: await q('SELECT * FROM users WHERE company_id = $1 OR school_id = $2 ORDER BY id'),
    students: await q('SELECT * FROM students WHERE company_id = $1 OR school_id = $2 ORDER BY id'),
    vans: await q('SELECT * FROM vans WHERE company_id = $1 OR $2::uuid IS NULL ORDER BY id'),
    assignments: await q('SELECT * FROM assignments WHERE company_id = $1 OR $2::uuid IS NULL ORDER BY id'),
    overrides: await q('SELECT * FROM assignment_schedule_overrides WHERE company_id = $1 OR $2::uuid IS NULL ORDER BY id'),
    pay_rules: await q('SELECT * FROM pay_rules WHERE company_id = $1 OR $2::uuid IS NULL ORDER BY id'),
    pay_adjustments: await q('SELECT * FROM pay_adjustments WHERE company_id = $1 OR $2::uuid IS NULL ORDER BY id'),
    sessions: await q('SELECT * FROM sessions WHERE company_id = $1 OR $2::uuid IS NULL ORDER BY id'),
    trips: await q('SELECT * FROM trips WHERE company_id = $1 OR school_id = $2 ORDER BY id'),
    parent_students: await q('SELECT * FROM parent_students WHERE company_id = $1 OR $2::uuid IS NULL ORDER BY id'),
    staff_access: await q('SELECT * FROM staff_student_access WHERE school_id = $2 OR $1::uuid IS NULL ORDER BY id'),
    monitor_assignments: await q('SELECT * FROM monitor_assignments WHERE company_id = $1 OR $2::uuid IS NULL ORDER BY id'),
    import_mappings: await q("SELECT * FROM import_mappings WHERE (tenant_type = 'company' AND tenant_id = $1) OR (tenant_type = 'school' AND tenant_id = $2) ORDER BY id"),
    contacts: await q('SELECT * FROM student_contacts WHERE company_id = $1 OR school_id = $2 ORDER BY id'),
    skips: await q('SELECT * FROM pickup_skips WHERE company_id = $1 OR $2::uuid IS NULL ORDER BY id'),
    no_shows: await q('SELECT * FROM pickup_no_shows WHERE company_id = $1 OR $2::uuid IS NULL ORDER BY id'),
    schedule_changes: await q('SELECT * FROM schedule_changes WHERE company_id = $1 OR school_id = $2 ORDER BY id'),
    reset_log: await q('SELECT l.* FROM password_reset_log l JOIN users u ON u.id = l.target_user_id WHERE u.company_id = $1 OR u.school_id = $2 ORDER BY l.id'),
    companyB: await q('SELECT * FROM companies WHERE id = $1 OR $2::uuid IS NULL'),
    schoolS2: await q('SELECT * FROM schools WHERE id = $2 OR $1::uuid IS NULL'),
  };
  return JSON.stringify(parts);
}

async function main() {
  const epg = await startEmbeddedPostgres('25-tenant-isolation', PG_PORT);
  try {
    runMigrateUp();
    const hash = await hashPassword(PW);
    const one = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);

    // ---- two full tenants on each side ----------------------------------------------------------
    const A = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id")).id;
    const B = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id")).id;
    const S1 = (await one("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School One','claimed',now()) RETURNING id")).id;
    const S2 = (await one("INSERT INTO schools(name,address,phone,claim_status,claimed_at) VALUES('School Two','2 Private Rd','555-0202','claimed',now()) RETURNING id")).id;
    const user = async (email, role, company, school = null) => (await one(
      'INSERT INTO users(email,password_hash,full_name,role,company_id,school_id,phone,address,email_verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) RETURNING id',
      [email, hash, email.split('@')[0], role, company, school, '555-0100', '1 Home St']
    )).id;
    const u = {
      adminA: await user('admin@a.test', 'company_admin', A), driverA: await user('driver@a.test', 'driver', A),
      parentA: await user('parent@a.test', 'parent', A), monitorA: await user('monitor@a.test', 'monitor', A),
      sadmin1: await user('sadmin@s1.test', 'school_admin', null, S1), staff1: await user('staff@s1.test', 'school_staff', null, S1),
      adminB: await user('admin@b.test', 'company_admin', B), driverB: await user('driver@b.test', 'driver', B),
      parentB: await user('parent@b.test', 'parent', B), monitorB: await user('monitor@b.test', 'monitor', B),
      sadmin2: await user('sadmin@s2.test', 'school_admin', null, S2), staff2: await user('staff@s2.test', 'school_staff', null, S2),
    };
    const student = async (company, school, name) => (await one(
      `INSERT INTO students(company_id,school_id,full_name,grade,age,parent_name,parent_phone,street_address,city,state,zip_code,notes)
       VALUES($1,$2,$3,'3',8,'P','555-0199','9 Secret Ln','Chicago','IL','60601','None') RETURNING id`,
      [company, school, name]
    )).id;
    const stuA = await student(A, S1, 'Alice Alpha');
    const stuB = await student(B, S2, 'Bobby Bravo');
    const vanA = (await one("INSERT INTO vans(company_id,license_plate,brand,model,year,color) VALUES($1,'A-100','Ford','T',2022,'White') RETURNING id", [A])).id;
    const vanB = (await one("INSERT INTO vans(company_id,license_plate,brand,model,year,color) VALUES($1,'B-200','Ford','T',2022,'Blue') RETURNING id", [B])).id;
    const asg = (company, stu, drv, van) => one(
      "INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,days_of_week,pickup_time) VALUES($1,$2,$3,$4,'2020-01-01','{1,2,3,4,5,6,7}','23:59') RETURNING id",
      [company, stu, drv, van]
    ).then((r) => r.id);
    await asg(A, stuA, u.driverA, vanA);
    const asgB = await asg(B, stuB, u.driverB, vanB);
    for (const [c, d] of [[A, u.driverA], [B, u.driverB], [B, u.monitorB]]) {
      await pool.query("INSERT INTO pay_rules(driver_id,company_id,rate_type,rate_cents) VALUES($1,$2,'hourly',2000)", [d, c]);
      await pool.query("INSERT INTO pay_adjustments(driver_id,company_id,amount_cents,note,work_date) VALUES($1,$2,500,'bonus','2026-01-05')", [d, c]);
    }
    const sessB = (await one("INSERT INTO sessions(user_id,company_id,shift_period) VALUES($1,$2,'morning') RETURNING id", [u.driverB, B])).id;
    const tripB = (await one(
      "INSERT INTO trips(session_id,company_id,student_id,school_id,trip_type,shift_period,driver_confirmed_at,status) VALUES($1,$2,$3,$4,'pickup','morning',now(),'pending') RETURNING id",
      [sessB, B, stuB, S2]
    )).id;
    await pool.query('INSERT INTO parent_students(parent_user_id,student_id,company_id) VALUES($1,$2,$3),($4,$5,$6)', [u.parentA, stuA, A, u.parentB, stuB, B]);
    await pool.query('INSERT INTO staff_student_access(staff_user_id,student_id,school_id) VALUES($1,$2,$3),($4,$5,$6)', [u.staff1, stuA, S1, u.staff2, stuB, S2]);
    await pool.query('INSERT INTO monitor_assignments(company_id,monitor_user_id,driver_user_id) VALUES($1,$2,$3)', [B, u.monitorB, u.driverB]);
    await pool.query("INSERT INTO import_mappings(tenant_type,tenant_id,import_type,mapping) VALUES('company',$1,'drivers','{\"email\":\"B secret column\"}')", [B]);
    await pool.query("INSERT INTO assignment_schedule_overrides(company_id,assignment_id,override_date,skip) VALUES($1,$2,'2030-01-02',false)", [B, asgB]);
    await pool.query("INSERT INTO student_contacts(company_id,school_id,student_id,name) VALUES($1,$2,$3,'Grandma B')", [B, S2, stuB]);

    const FOREIGN = [u.adminB, u.driverB, u.parentB, u.monitorB, u.sadmin2, u.staff2, stuB, vanB, asgB, sessB, tripB, S2, 'Bobby Bravo', 'Grandma B', 'B secret column', 'driver@b.test'];
    const leaks = (body) => FOREIGN.filter((f) => JSON.stringify(body ?? '').includes(f));

    const app = createApp();
    const server = app.listen(5982);
    try {
      const tok = {
        company_admin: await login('admin@a.test'), driver: await login('driver@a.test'), parent: await login('parent@a.test'),
        monitor: await login('monitor@a.test'), school_admin: await login('sadmin@s1.test'), school_staff: await login('staff@s1.test'),
      };
      const before = await snapshotB(B, S2);

      // [label, method, path, body]: must answer non-2xx.
      const denied = [
        ['read B driver', 'GET', `/users/${u.driverB}`],
        ['read S2 staff', 'GET', `/users/${u.staff2}`],
        ['read B student', 'GET', `/students/${stuB}`],
        ['read B student addresses', 'GET', `/students/${stuB}/addresses`],
        ['read B van', 'GET', `/vans/${vanB}`],
        ['read B assignment', 'GET', `/assignments/${asgB}`],
        ['read B assignment overrides', 'GET', `/assignments/${asgB}/overrides`],
        ['read B trip', 'GET', `/trips/${tripB}`],
        ['read B session', 'GET', `/sessions/${sessB}`],
        ['read B pay summary', 'GET', `/payroll/summary/${u.driverB}`],
        ['read B unpaid summary', 'GET', `/payroll/unpaid-summary/${u.driverB}`],
        ['read S2 school detail', 'GET', `/schools/${S2}`],
        ['read B student as parent', 'GET', `/parent/students/${stuB}/detail`],
        ['read B skip status', 'GET', `/parent/students/${stuB}/skip-status`],
        ['edit B driver', 'PATCH', `/users/${u.driverB}`, { full_name: 'Hijacked' }],
        ['deactivate B driver', 'PATCH', `/users/${u.driverB}`, { is_active: false }],
        ['change B driver email', 'PATCH', `/users/${u.driverB}`, { email: 'attacker@a.test' }],
        ['reset B driver password', 'POST', `/users/${u.driverB}/reset-password`],
        ['edit S2 staff', 'PATCH', `/users/${u.staff2}`, { full_name: 'Hijacked' }],
        ['reset S2 staff password', 'POST', `/users/${u.staff2}/reset-password`],
        ['edit B student', 'PATCH', `/students/${stuB}`, { notes: 'hijacked' }],
        ['delete B student', 'DELETE', `/students/${stuB}`],
        ['add contact to B student', 'POST', `/students/${stuB}/contacts`, { name: 'Intruder' }],
        ['add address to B student', 'POST', `/students/${stuB}/addresses`, { label: 'x', street_address: '1 X St', city: 'C', state: 'IL', zip_code: '60601', days_of_week: [1], applies_to: 'both' }],
        ['edit B van', 'PATCH', `/vans/${vanB}`, { color: 'Black' }],
        ['delete B van', 'DELETE', `/vans/${vanB}`],
        ['edit B assignment', 'PATCH', `/assignments/${asgB}`, { pickup_time: '07:00' }],
        ['delete B assignment', 'DELETE', `/assignments/${asgB}`],
        ['assignment from B ids', 'POST', '/assignments', { student_id: stuB, driver_user_id: u.driverB, van_id: vanB, start_date: '2030-01-01' }],
        ['override on B assignment', 'POST', `/assignments/${asgB}/overrides`, { override_date: '2030-01-03', skip: true }],
        ['set B pay rate', 'PUT', `/payroll/rules/${u.driverB}`, { rate_type: 'hourly', rate_cents: 1 }],
        ['add B adjustment', 'POST', '/payroll/adjustments', { driver_id: u.driverB, amount_cents: 99999, note: 'x', work_date: '2026-01-06' }],
        ['mark B paid', 'POST', `/payroll/rules/${u.driverB}/mark-paid`],
        ['confirm B trip', 'POST', `/trips/${tripB}/confirm`],
        ['log trip for B student', 'POST', '/trips', { student_id: stuB, trip_type: 'pickup', shift_period: 'morning' }],
        ['check out B session', 'POST', `/sessions/${sessB}/checkout`],
        ['link to B parent/student', 'POST', '/parent-access', { parent_user_id: u.parentB, student_id: stuB }],
        ['grant S2 staff/student', 'POST', '/staff-access', { staff_user_id: u.staff2, student_id: stuB }],
        ['assign B monitor', 'PUT', `/monitors/${u.monitorB}/assignment`, { driver_user_id: u.driverB }],
        ['unassign B monitor', 'DELETE', `/monitors/${u.monitorB}/assignment`],
        ['skip B pickup', 'POST', `/parent/students/${stuB}/skip-pickup`, {}],
        ['schedule change for B student', 'POST', `/schedule-changes/students/${stuB}`, { change_type: 'left_early' }],
        ['no-show on B assignment', 'POST', `/schedule/${asgB}/no-show`, { shift_period: 'morning' }],
        ['edit S2 as placeholder', 'PATCH', `/placeholders/school/${S2}`, { name: 'Renamed' }],
        ['edit B as placeholder', 'PATCH', `/placeholders/company/${B}`, { name: 'Renamed' }],
      ];
      // Lists answer 200 for allowed roles: nothing of B/S2 may appear.
      const lists = ['/users', '/students', '/vans', '/assignments', '/trips', '/sessions', '/payroll/rules', '/parent-access',
        '/staff-access', '/monitors', '/dashboard/absent-today', '/schedule-changes', '/schools', '/parent/students', '/monitor/me',
        '/schedule/today', '/payroll/summary/company', `/payroll/adjustments/${u.driverB}`, '/imports/mapping?type=drivers', '/imports/mapping?type=staff', '/schools/me', '/companies/me'];
      // Imports answer 200 with per-row results: nothing may be created or updated.
      const imports = [
        ['import B driver email as driver', { type: 'drivers', rows: [{ full_name: 'Hijack', email: 'driver@b.test' }] }],
        ['import B parent email as parent', { type: 'parents', rows: [{ full_name: 'Hijack', email: 'parent@b.test', phone: '1', address: '1' }] }],
        ['import B monitor email as monitor', { type: 'monitors', rows: [{ full_name: 'Hijack', email: 'monitor@b.test' }] }],
        ['import S2 staff email as staff', { type: 'staff', rows: [{ full_name: 'Hijack', email: 'staff@s2.test' }] }],
        ['import student into S2 by name', { type: 'students', rows: [{ full_name: 'Intruder Kid', school: 'School Two', grade: '1', age: '6', parent_name: 'P', parent_phone: '1', street_address: '1', city: 'C', state: 'IL', zip_code: '60601' }] }],
        ['import student with B parent email', { type: 'students', rows: [{ full_name: 'Alice Alpha', school: 'School One', grade: '3', age: '8', parent_name: 'P', parent_phone: '1', parent_email: 'parent@b.test', street_address: '1', city: 'C', state: 'IL', zip_code: '60601' }] }],
      ];

      for (const [role, t] of Object.entries(tok)) {
        console.log(`\n--- ${role} (A side) vs company B / school S2 ---`);
        let deniedOk = 0;
        for (const [label, method, path, body] of denied) {
          const r = await api(method, path, t, body);
          if (is2xx(r.status)) bad(`${role}: ${label} (${method} ${path}) -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
          else deniedOk++;
        }
        eq(`${role}: all ${denied.length} direct reads/writes of B/S2 records refused`, deniedOk, denied.length);
        let listOk = 0;
        for (const path of lists) {
          const r = await api('GET', path, t);
          const found = is2xx(r.status) ? leaks(r.body) : [];
          if (found.length) bad(`${role}: GET ${path} leaks ${found.join(', ')}`);
          else listOk++;
        }
        eq(`${role}: none of ${lists.length} list/profile reads show B/S2 data`, listOk, lists.length);
        let importOk = 0;
        for (const [label, body] of imports) {
          for (const step of ['preview', 'commit']) {
            const r = await api('POST', `/imports/${step}`, t, body);
            const wrote = is2xx(r.status) && step === 'commit' && (r.body.counts.created > 0 || r.body.counts.updated > 0);
            const found = is2xx(r.status) ? leaks(r.body?.rows) : [];
            if (wrote || found.length) bad(`${role}: ${label} (${step}) -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
            else importOk++;
          }
        }
        eq(`${role}: all ${imports.length * 2} cross-tenant import attempts write nothing`, importOk, imports.length * 2);
      }

      console.log('\n--- nothing of B / S2 changed ---');
      const after = await snapshotB(B, S2);
      after === before ? ok('every B / S2 row is unchanged after all attempts') : bad('B / S2 data changed during the attempts');

      console.log('\n--- KNOWN GAPS (asserting current behavior; see docs/tenant-isolation-audit.md) ---');
      // Gap 1 — FIXED (branch fix-student-school-scope): a company can only attach a student to a
      // school it is linked to, so it can't plant one at school S2 or read S2's details.
      const tA = tok.company_admin;
      const planted = await api('POST', '/students', tA, {
        full_name: 'Planted Kid', grade: '1', age: 6, parent_name: 'P', parent_phone: '1', school_id: S2,
        street_address: '1 X', city: 'C', state: 'IL', zip_code: '60601', notes: 'None',
      });
      eq('FIXED 1: company A creating a student at unrelated school S2 -> 403', planted.status, 403);
      const tS2 = await login('sadmin@s2.test');
      eq("FIXED 1: S2's admin sees no student from company A", (await api('GET', '/students', tS2)).body.some((s) => s.full_name === 'Planted Kid'), false);
      eq("FIXED 1: company A still can't read S2's details", (await api('GET', `/schools/${S2}`, tA)).status, 404);

      // Gap 2 — FIXED (branch fix-placeholder-claim): self-claiming a placeholder is refused, a claim
      // is only a request, and nothing is readable until the SafeTurns owner approves it.
      const tB = await login('admin@b.test');
      const stub = await api('POST', '/placeholders/school', tB, { name: 'Maple Placeholder Academy', address: '7 Maple St' });
      await api('POST', '/students', tB, {
        full_name: 'Maple Kid', grade: '2', age: 7, parent_name: 'Mom', parent_phone: '555-0177', school_id: stub.body.id,
        street_address: '7 Hidden Ct', city: 'C', state: 'IL', zip_code: '60601', notes: 'None',
      });
      mailer._reset();
      const claim = await api('POST', '/signup/school', null, { claimId: stub.body.id, fullName: 'Stranger', email: 'stranger@evil.test', password: PW });
      eq('FIXED 2: a stranger self-claiming the placeholder -> 403 CLAIM_REQUIRES_APPROVAL', `${claim.status} ${claim.body?.code}`, '403 CLAIM_REQUIRES_APPROVAL');
      eq('FIXED 2: no account, no verification email', `${(await pool.query("SELECT count(*)::int AS n FROM users WHERE email='stranger@evil.test'")).rows[0].n} ${(await mailer._drained()).length}`, '0 0');
      const asked = await api('POST', '/signup/school/claim-requests', null, { claimId: stub.body.id, fullName: 'Stranger', email: 'stranger@evil.test' });
      eq('FIXED 2: a claim request is accepted (202) but grants nothing', asked.status, 202);
      eq('FIXED 2: the stranger still cannot sign in', (await api('POST', '/auth/login', null, { email: 'stranger@evil.test', password: PW })).status, 401);
      eq('FIXED 2: the placeholder stays unclaimed', (await pool.query('SELECT claim_status FROM schools WHERE id=$1', [stub.body.id])).rows[0].claim_status, 'unclaimed');
      eq("FIXED 2: company B's student at the placeholder is still only company B's",
        (await pool.query("SELECT count(*)::int AS n FROM students WHERE full_name='Maple Kid' AND company_id=$1", [B])).rows[0].n, 1);

      // Gap 3 (low): creating a user tells any admin whether an email is registered in another tenant.
      const probe = await api('POST', '/users', tA, { email: 'driver@b.test', fullName: 'Probe', role: 'driver' });
      eq("KNOWN GAP 3: creating a user with company B's driver email answers 409 'email already registered'", probe.status, 409);
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
