// School staff/admin pickup-confirmation workflow (2026-09-02): school_admin added to trip
// confirmation, school-scoped absent-today for school_admin/school_staff, companies.phone +
// /companies/me, /parent/me, and the new "left early"/"staying later" schedule-change log
// (notification fan-out + left_early's real skip-override side effect).
const PG_PORT = 5463;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-13';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const mailer = require('../src/mail/mailer.js');

const rec = createRecorder('13-pickup-confirmation');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5300';
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
  const epg = await startEmbeddedPostgres('13-pickup-confirmation', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const admin = await ins("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('admin@co.com',$1,'Admin','company_admin',$2,now()) RETURNING id", [hash, A.id]);
    const schoolAdmin = await ins("INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('sa@sch.com',$1,'School Admin','school_admin',$2,now()) RETURNING id", [hash, S.id]);
    const staff1 = await ins("INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('staff1@sch.com',$1,'Staff1','school_staff',$2,now()) RETURNING id", [hash, S.id]);
    const staff2 = await ins("INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('staff2@sch.com',$1,'Staff2','school_staff',$2,now()) RETURNING id", [hash, S.id]);
    const driver = await ins("INSERT INTO users(email,password_hash,full_name,role,company_id,phone,email_verified_at) VALUES('drv@co.com',$1,'Driver One','driver',$2,'555-0200',now()) RETURNING id", [hash, A.id]);
    const parent = await ins("INSERT INTO users(email,password_hash,full_name,role,company_id,phone,address,email_verified_at) VALUES('parent@co.com',$1,'Parent One','parent',$2,'555-0300','9 Home St, Boston, MA 02139',now()) RETURNING id", [hash, A.id]);
    const van = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'AAA-1','Ford','Transit',2022) RETURNING id", [A.id]);

    const app = createApp();
    const server = app.listen(5300);
    try {
      const adminTok = await login('admin@co.com');
      const schoolAdminTok = await login('sa@sch.com');
      const staff1Tok = await login('staff1@sch.com');
      const staff2Tok = await login('staff2@sch.com');
      const driverTok = await login('drv@co.com');
      const parentTok = await login('parent@co.com');

      const stu = (await api('POST', '/students', adminTok, {
        full_name: 'Kid One', school_id: S.id, grade: '3', age: 8, parent_name: 'Parent One', parent_phone: '555-0300',
        street_address: '5 Elm St', city: 'Boston', state: 'MA', zip_code: '02139', notes: 'None',
      })).body;
      const asg = (await api('POST', '/assignments', adminTok, {
        student_id: stu.id, driver_user_id: driver.id, van_id: van.id, start_date: '2020-01-01',
      })).body;
      await ins('INSERT INTO staff_student_access(staff_user_id,student_id,school_id) VALUES($1,$2,$3) RETURNING id', [staff1.id, stu.id, S.id]);
      await ins('INSERT INTO parent_students(parent_user_id,student_id,company_id,created_by_user_id) VALUES($1,$2,$3,$4) RETURNING id', [parent.id, stu.id, A.id, admin.id]);

      console.log('--- Trip confirmation: school_admin can now confirm, not just school_staff ---');
      await api('POST', '/sessions/checkin', driverTok, {});
      const trip1 = (await api('POST', '/trips', driverTok, { student_id: stu.id, trip_type: 'dropoff' })).body;
      eq('company_admin confirming a trip -> 403 (not a school role)', (await api('POST', `/trips/${trip1.id}/confirm`, adminTok)).status, 403);
      eq('driver confirming a trip -> 403', (await api('POST', `/trips/${trip1.id}/confirm`, driverTok)).status, 403);
      eq('non-granted staff2 confirming -> 404 (not their granted student)', (await api('POST', `/trips/${trip1.id}/confirm`, staff2Tok)).status, 404);
      const confBySchoolAdmin = await api('POST', `/trips/${trip1.id}/confirm`, schoolAdminTok);
      (confBySchoolAdmin.status === 200 && confBySchoolAdmin.body.status === 'complete')
        ? ok('school_admin confirms trip -> 200 complete (new capability)')
        : bad(`school_admin confirm: ${confBySchoolAdmin.status} ${JSON.stringify(confBySchoolAdmin.body)}`);

      const trip2 = (await api('POST', '/trips', driverTok, { student_id: stu.id, trip_type: 'pickup' })).body;
      const confByStaff = await api('POST', `/trips/${trip2.id}/confirm`, staff1Tok);
      eq('granted school_staff still confirms trips -> 200 (unchanged)', confByStaff.status, 200);

      console.log('\n--- Absent Today, extended to school_admin/school_staff (school-scoped, no school_id on the source tables) ---');
      await pool.query('INSERT INTO pickup_skips(company_id,student_id,parent_user_id,skip_date) VALUES($1,$2,$3,CURRENT_DATE)', [A.id, stu.id, parent.id]);
      await pool.query('INSERT INTO pickup_no_shows(company_id,student_id,driver_user_id,no_show_date) VALUES($1,$2,$3,CURRENT_DATE)', [A.id, stu.id, driver.id]);
      const absentCompany = await api('GET', '/dashboard/absent-today', adminTok);
      eq('company_admin absent-today unaffected, sees both entries', absentCompany.body.length, 2);
      const absentSchoolAdmin = await api('GET', '/dashboard/absent-today', schoolAdminTok);
      (absentSchoolAdmin.status === 200 && absentSchoolAdmin.body.length === 2)
        ? ok('school_admin sees both absent-today entries for their school (new capability)')
        : bad(`school_admin absent-today: ${absentSchoolAdmin.status} ${JSON.stringify(absentSchoolAdmin.body)}`);
      const absentStaff1 = await api('GET', '/dashboard/absent-today', staff1Tok);
      eq('granted school_staff (staff1) also sees both entries (granted student)', absentStaff1.body.length, 2);
      const absentStaff2 = await api('GET', '/dashboard/absent-today', staff2Tok);
      eq('non-granted school_staff (staff2) sees 0 entries (least-privilege sub-scope)', absentStaff2.body.length, 0);
      eq('driver hitting absent-today -> 403 (still gated)', (await api('GET', '/dashboard/absent-today', driverTok)).status, 403);

      console.log('\n--- Company profile (companies.phone + /companies/me) ---');
      eq('school_admin hitting /companies/me -> 403', (await api('GET', '/companies/me', schoolAdminTok)).status, 403);
      const companyPatch = await api('PATCH', '/companies/me', adminTok, { name: 'Co A', address: '1 Depot Rd', zip_code: '02139', state: 'MA', phone: '555-9000' });
      (companyPatch.status === 200 && companyPatch.body.phone === '555-9000')
        ? ok('company_admin sets companies.phone via PATCH /companies/me')
        : bad(`company patch: ${companyPatch.status} ${JSON.stringify(companyPatch.body)}`);

      console.log('\n--- Parent self-profile + student detail enrichment ---');
      const parentMe = await api('GET', '/parent/me', parentTok);
      (parentMe.status === 200 && parentMe.body.phone === '555-0300' && parentMe.body.address === '9 Home St, Boston, MA 02139')
        ? ok('GET /parent/me returns phone/address (not on the cached AuthUser)')
        : bad(`parent/me: ${parentMe.status} ${JSON.stringify(parentMe.body)}`);
      const detail = await api('GET', `/parent/students/${stu.id}/detail`, parentTok);
      (detail.status === 200 && detail.body.company.phone === '555-9000' && detail.body.student.grade === '3')
        ? ok('parent student-detail now includes company.phone and student.grade')
        : bad(`detail: ${detail.status} ${JSON.stringify(detail.body)}`);

      console.log('\n--- Schedule changes: role gating ---');
      eq('company_admin logging a schedule change -> 403', (await api('POST', `/schedule-changes/students/${stu.id}`, adminTok, { change_type: 'left_early' })).status, 403);
      eq('driver logging a schedule change -> 403', (await api('POST', `/schedule-changes/students/${stu.id}`, driverTok, { change_type: 'left_early' })).status, 403);
      eq('invalid change_type -> 400', (await api('POST', `/schedule-changes/students/${stu.id}`, schoolAdminTok, { change_type: 'nope' })).status, 400);

      console.log('\n--- "staying_later": logs + notifies + ALSO skips today\'s pickup (same real effect as left_early) ---');
      mailer._reset();
      const staying = await api('POST', `/schedule-changes/students/${stu.id}`, staff1Tok, { change_type: 'staying_later', note: 'Practice runs long' });
      (staying.status === 201 && staying.body.change_type === 'staying_later' && staying.body.skipped_assignment_id === asg.id)
        ? ok('staying_later logs a change and cancels the scheduled pickup, same as left_early')
        : bad(`staying_later: ${staying.status} ${JSON.stringify(staying.body)}`);
      const sentToStaying = mailer._sent().map((m) => m.to).sort();
      const expectedRecipients = ['admin@co.com', 'sa@sch.com', 'drv@co.com', 'parent@co.com'].sort();
      (JSON.stringify(sentToStaying) === JSON.stringify(expectedRecipients))
        ? ok('staying_later notifies company_admin + school_admin + assigned driver + linked parent (exactly)')
        : bad(`notified: ${JSON.stringify(sentToStaying)} expected ${JSON.stringify(expectedRecipients)}`);
      const overrideAfterStaying = await pool.query(
        "SELECT skip FROM assignment_schedule_overrides WHERE assignment_id = $1 AND override_date = CURRENT_DATE", [asg.id]
      );
      (overrideAfterStaying.rowCount === 1 && overrideAfterStaying.rows[0].skip === true)
        ? ok('staying_later sets today\'s assignment_schedule_overrides.skip = true too')
        : bad(`override after staying_later: ${JSON.stringify(overrideAfterStaying.rows)}`);

      console.log('\n--- "left_early": logs + notifies + skips today\'s pickup override (cross-tenant write) ---');
      mailer._reset();
      const leftEarly = await api('POST', `/schedule-changes/students/${stu.id}`, schoolAdminTok, { change_type: 'left_early' });
      (leftEarly.status === 201 && leftEarly.body.change_type === 'left_early' && leftEarly.body.skipped_assignment_id === asg.id)
        ? ok('left_early logs a change and reports the skipped assignment id')
        : bad(`left_early: ${leftEarly.status} ${JSON.stringify(leftEarly.body)}`);
      const overrideAfterLeftEarly = await pool.query(
        "SELECT skip, company_id FROM assignment_schedule_overrides WHERE assignment_id = $1 AND override_date = CURRENT_DATE", [asg.id]
      );
      (overrideAfterLeftEarly.rows[0]?.skip === true && overrideAfterLeftEarly.rows[0]?.company_id === A.id)
        ? ok('left_early sets today\'s assignment_schedule_overrides.skip = true, correct company_id (cross-tenant write)')
        : bad(`override after left_early: ${JSON.stringify(overrideAfterLeftEarly.rows)}`);
      const sentToLeftEarly = mailer._sent().map((m) => m.to).sort();
      eq('left_early also notifies all 4 recipients', JSON.stringify(sentToLeftEarly), JSON.stringify(expectedRecipients));
      // Driver's own schedule view should now reflect the skip for today.
      const driverSchedule = (await api('GET', '/schedule/today', driverTok)).body;
      const scheduleRow = driverSchedule.find((r) => r.assignment_id === asg.id);
      (scheduleRow && scheduleRow.override && scheduleRow.override.skip === true)
        ? ok("driver's own /schedule/today reflects the left_early skip via the existing override mechanism")
        : bad(`driver schedule row: ${JSON.stringify(scheduleRow)}`);

      console.log('\n--- Schedule changes: reading the log back, least-privilege sub-scope ---');
      const changesSchoolAdmin = await api('GET', '/schedule-changes', schoolAdminTok);
      eq('school_admin sees both logged changes today', changesSchoolAdmin.body.length, 2);
      const changesStaff1 = await api('GET', '/schedule-changes', staff1Tok);
      eq('granted staff1 sees both (granted student)', changesStaff1.body.length, 2);
      const changesStaff2 = await api('GET', '/schedule-changes', staff2Tok);
      eq('non-granted staff2 sees 0 (least-privilege)', changesStaff2.body.length, 0);
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
