// Staff-access grants (§7.3) + the school_staff "granted students only" scoping fix on
// Students (§7.4) — verifies both the new write side and the corrected read side.
const PG_PORT = 5455;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-06';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('06-staff-access');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:4600';
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
  const epg = await startEmbeddedPostgres('06-staff-access', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const S2 = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S2','claimed',now()) RETURNING id");
    await ins("INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('sa@s.com',$1,'SchoolAdmin','school_admin',$2,now()) RETURNING id", [hash, S.id]);
    const staff1 = await ins("INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('staff1@s.com',$1,'Staff1','school_staff',$2,now()) RETURNING id", [hash, S.id]);
    await ins("INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('staff2@s.com',$1,'Staff2','school_staff',$2,now()) RETURNING id", [hash, S.id]);
    const staffOtherSchool = await ins("INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('outsider@s2.com',$1,'Outsider','school_staff',$2,now()) RETURNING id", [hash, S2.id]);
    const stu1 = await ins("INSERT INTO students(company_id,school_id,full_name,grade) VALUES($1,$2,'Kid One','3') RETURNING id", [A.id, S.id]);
    const stu2 = await ins("INSERT INTO students(company_id,school_id,full_name,grade) VALUES($1,$2,'Kid Two','4') RETURNING id", [A.id, S.id]);

    const app = createApp();
    const server = app.listen(4600);
    try {
      const schoolAdmin = await login('sa@s.com');
      const staff1Tok = await login('staff1@s.com');
      const staff2Tok = await login('staff2@s.com');

      console.log('--- Grant access (school_admin only) ---');
      eq('school_staff granting access -> 403 (not school_admin)', (await api('POST', '/staff-access', staff1Tok, { staff_user_id: staff1.id, student_id: stu1.id })).status, 403);
      const grant1 = await api('POST', '/staff-access', schoolAdmin, { staff_user_id: staff1.id, student_id: stu1.id });
      eq('school_admin grants staff1 -> stu1 -> 201', grant1.status, 201);
      eq('duplicate grant -> 409', (await api('POST', '/staff-access', schoolAdmin, { staff_user_id: staff1.id, student_id: stu1.id })).status, 409);
      eq('grant with cross-school staff -> 400 (composite FK)', (await api('POST', '/staff-access', schoolAdmin, { staff_user_id: staffOtherSchool.id, student_id: stu1.id })).status, 400);

      console.log('\n--- List + revoke ---');
      const list1 = await api('GET', '/staff-access', schoolAdmin);
      eq('GET /staff-access lists 1 grant', list1.body.length, 1);
      eq('revoke -> 204', (await api('DELETE', `/staff-access/${grant1.body.id}`, schoolAdmin)).status, 204);
      const list2 = await api('GET', '/staff-access', schoolAdmin);
      eq('GET /staff-access lists 0 grants after revoke', list2.body.length, 0);

      console.log('\n--- [security fix] school_staff scoped to GRANTED students only ---');
      await api('POST', '/staff-access', schoolAdmin, { staff_user_id: staff1.id, student_id: stu1.id });
      const staff1Students = await api('GET', '/students', staff1Tok);
      (staff1Students.body.length === 1 && staff1Students.body[0].id === stu1.id)
        ? ok('staff1 (granted stu1 only) sees exactly 1 student via GET /students') : bad(`staff1 saw: ${JSON.stringify(staff1Students.body)}`);
      const staff2Students = await api('GET', '/students', staff2Tok);
      eq('staff2 (no grants) sees 0 students via GET /students', staff2Students.body.length, 0);
      eq('staff1 GET non-granted student stu2 by id -> 404', (await api('GET', `/students/${stu2.id}`, staff1Tok)).status, 404);
      eq('staff1 GET granted student stu1 by id -> 200', (await api('GET', `/students/${stu1.id}`, staff1Tok)).status, 200);
      const adminStudents = await api('GET', '/students', schoolAdmin);
      eq('school_admin (unrestricted) still sees both students', adminStudents.body.length, 2);
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
