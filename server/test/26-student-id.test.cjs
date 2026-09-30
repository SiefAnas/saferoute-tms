// Student ID: an optional school-issued id on students, unique per company + school (any case).
// The import matches on Student ID + school when a row has one, and on name + school otherwise.
const PG_PORT = 5476;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-26';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('26-student-id');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5983';
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
  const epg = await startEmbeddedPostgres('26-student-id', PG_PORT);
  try {
    runMigrateUp();
    const hash = await hashPassword(PW);
    const one = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id")).id;
    const B = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id")).id;
    const S1 = (await one("INSERT INTO schools(name,claim_status,claimed_at) VALUES('Lincoln','claimed',now()) RETURNING id")).id;
    const S2 = (await one("INSERT INTO schools(name,claim_status,claimed_at) VALUES('Grant','claimed',now()) RETURNING id")).id;
    for (const [email, role, c, s] of [['admin@a.test', 'company_admin', A, null], ['admin@b.test', 'company_admin', B, null], ['sadmin@s1.test', 'school_admin', null, S1]]) {
      await pool.query('INSERT INTO users(email,password_hash,full_name,role,company_id,school_id,email_verified_at) VALUES($1,$2,$3,$4,$5,$6,now())', [email, hash, email, role, c, s]);
    }
    // Company B already transports one child at each school, so both are in B's school list too.
    for (const s of [S1, S2]) {
      await pool.query("INSERT INTO students(company_id,school_id,full_name,student_id) VALUES($1,$2,'B Kid',NULL)", [B, s]);
    }

    const app = createApp();
    const server = app.listen(5983);
    try {
      const tA = await login('admin@a.test');
      const tB = await login('admin@b.test');
      const tS = await login('sadmin@s1.test');
      const body = (o) => ({ full_name: 'Ann Lee', grade: '3', age: 8, parent_name: 'P', parent_phone: '555', school_id: S1, street_address: '1 Oak', city: 'Chicago', state: 'IL', zip_code: '60601', notes: 'None', ...o });

      console.log('--- create and edit ---');
      const a1 = await api('POST', '/students', tA, body({ student_id: '  S-001 ' }));
      eq('create with a Student ID -> 201, trimmed', `${a1.status} ${a1.body?.student_id}`, '201 S-001');
      eq('same ID at the same school, other case -> 409', (await api('POST', '/students', tA, body({ full_name: 'Bo', student_id: 's-001' }))).status, 409);
      eq('same ID at another school -> 201', (await api('POST', '/students', tA, body({ full_name: 'Cy', school_id: S2, student_id: 'S-001' }))).status, 201);
      const noId = await api('POST', '/students', tA, body({ full_name: 'Di', student_id: '' }));
      eq('blank Student ID is stored as none', `${noId.status} ${noId.body?.student_id}`, '201 null');
      eq('any number of students without an ID', (await api('POST', '/students', tA, body({ full_name: 'Ed' }))).status, 201);
      eq('ID over 50 characters -> 400', (await api('POST', '/students', tA, body({ full_name: 'Fi', student_id: 'x'.repeat(51) }))).status, 400);
      eq('another company, same school, same ID -> 201 (unique per company + school)', (await api('POST', '/students', tB, body({ full_name: 'Gus', student_id: 'S-001' }))).status, 201);
      const setId = await api('PATCH', `/students/${noId.body.id}`, tA, { student_id: 'S-002' });
      eq('edit adds an ID', setId.body?.student_id, 'S-002');
      eq('edit to a used ID -> 409', (await api('PATCH', `/students/${noId.body.id}`, tA, { student_id: 'S-001' })).status, 409);
      eq('edit clears an ID with null', (await api('PATCH', `/students/${noId.body.id}`, tA, { student_id: null })).body?.student_id, null);
      await api('PATCH', `/students/${noId.body.id}`, tA, { student_id: 'S-002' });

      console.log('\n--- shown to admins ---');
      eq('company list includes student_id', (await api('GET', '/students', tA)).body.find((s) => s.id === a1.body.id)?.student_id, 'S-001');
      eq('school admin list includes student_id', (await api('GET', '/students', tS)).body.find((s) => s.id === a1.body.id)?.student_id, 'S-001');
      eq('student detail includes student_id', (await api('GET', `/students/${a1.body.id}`, tA)).body?.student_id, 'S-001');

      console.log('\n--- import ---');
      const row = (o) => ({ full_name: 'Ann Lee', school: 'Lincoln', grade: '4', age: '9', parent_name: 'P', parent_phone: '555', street_address: '1 Oak', city: 'Chicago', state: 'IL', zip_code: '60601', ...o });
      const types = (await api('GET', '/imports/types', tA)).body.types.find((t) => t.id === 'students');
      ok(types.fields.some((f) => f.key === 'student_id' && !f.required) ? 'import offers an optional Student ID column' : bad('no student_id field'));
      const rows = [
        row({ full_name: 'Ann Renamed', student_id: 's-001' }), // 0 matches Ann Lee by ID, even with another name
        row({ full_name: 'New Kid', student_id: 'S-100' }), // 1 new ID -> create
        row({ full_name: 'Twin', student_id: 'S-200' }), // 2 duplicate ID in the file
        row({ full_name: 'Twin Two', student_id: 'S-200' }), // 3
        row({ full_name: 'Same Name', student_id: 'S-300' }), // 4 two different children, same name, different IDs
        row({ full_name: 'Same Name', student_id: 'S-301' }), // 5
        row({ full_name: 'Ed' }), // 6 no ID -> name + school fallback
        row({ full_name: 'B Kid', student_id: 'S-400' }), // 7 name matches only company B's student: not ours -> create
        row({ full_name: 'Di', grade: '7' }), // 8 no ID, name matches Di who has S-002 -> update, keeps the ID
        row({ full_name: 'Cy', school: 'Grant', student_id: 'S-200' }), // 9 same ID as rows 2/3 but another school: fine... (Cy has S-001 at Grant, so this is a new ID there)
      ];
      await pool.query("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,'No Id Yet')", [A, S1]);
      rows.push(row({ full_name: 'No Id Yet', student_id: 'S-500' })); // 10 exactly one same-name student without an ID -> update, adds the ID
      await pool.query("INSERT INTO students(company_id,school_id,full_name,student_id) VALUES($1,$2,'Other Co Kid','S-999')", [B, S1]);
      rows.push(row({ full_name: 'Mine', student_id: 'S-999' })); // 11 ID another company uses at this school -> fine, create
      await pool.query("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,'Twin No Id'),($1,$2,'Twin No Id')", [A, S1]);
      rows.push(row({ full_name: 'Twin No Id', student_id: 'S-600' })); // 12 two same-name students without an ID -> ambiguous, row error
      const pv = await api('POST', '/imports/preview', tA, { type: 'students', rows });
      eq('preview actions', pv.body.rows.map((r) => r.action).join(), 'update,create,error,error,create,create,update,create,update,create,update,create,error');
      ok(/Duplicate Student ID/.test(pv.body.rows[2].reason) && /Duplicate Student ID/.test(pv.body.rows[3].reason) ? 'both rows with the same Student ID are errors' : bad(`dup: ${pv.body.rows[2].reason}`));
      eq('the preview says the existing student gets the ID (never silent)', pv.body.rows[10].note, 'Adds Student ID S-500 to the existing student');
      ok(/More than one student with this name/.test(pv.body.rows[12].reason) ? 'two same-name students without an ID: a row error, no guess' : bad(pv.body.rows[12].reason));

      const before = (await pool.query('SELECT count(*)::int AS n FROM students WHERE company_id=$1', [A])).rows[0].n;
      const cm = await api('POST', '/imports/commit', tA, { type: 'students', rows });
      eq('commit counts', JSON.stringify(cm.body.counts), '{"created":6,"updated":4,"error":3}');
      eq('6 new students', (await pool.query('SELECT count(*)::int AS n FROM students WHERE company_id=$1', [A])).rows[0].n - before, 6);
      eq('the existing student now carries the new ID (no second student)', JSON.stringify((await pool.query("SELECT student_id FROM students WHERE company_id=$1 AND full_name='No Id Yet'", [A])).rows), '[{"student_id":"S-500"}]');
      eq("company A's S-999 sits next to company B's", (await pool.query("SELECT count(*)::int AS n FROM students WHERE school_id=$1 AND student_id='S-999'", [S1])).rows[0].n, 2);
      const ann = (await pool.query('SELECT full_name, grade, student_id FROM students WHERE id=$1', [a1.body.id])).rows[0];
      eq('matched by ID: renamed and updated, ID kept', `${ann.full_name} ${ann.grade} ${ann.student_id}`, 'Ann Renamed 4 S-001');
      eq('two children with one name and different IDs both exist', (await pool.query("SELECT count(*)::int AS n FROM students WHERE company_id=$1 AND full_name='Same Name'", [A])).rows[0].n, 2);
      const di = (await pool.query("SELECT grade, student_id FROM students WHERE company_id=$1 AND full_name='Di'", [A])).rows[0];
      eq('no-ID row updated by name and kept the existing ID', `${di.grade} ${di.student_id}`, '7 S-002');
      eq('new students carry their ID', (await pool.query("SELECT student_id FROM students WHERE company_id=$1 AND full_name='New Kid'", [A])).rows[0].student_id, 'S-100');
      eq("company B's student is untouched", (await pool.query("SELECT count(*)::int AS n FROM students WHERE company_id=$1 AND full_name='B Kid' AND student_id IS NULL", [B])).rows[0].n, 2);
      const again = await api('POST', '/imports/commit', tA, { type: 'students', rows: [row({ full_name: 'New Kid', student_id: 'S-100', grade: '5' })] });
      eq('importing the same ID again updates, never duplicates', JSON.stringify(again.body.counts), '{"created":0,"updated":1,"error":0}');
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
