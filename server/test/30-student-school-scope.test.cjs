// A company may only attach a student to a school it is linked to: it already has a student
// there, or one of its users created that school (a placeholder). Anything else is a 403 with the
// same message whether the school exists or not. The bulk import follows the same rule.
const PG_PORT = 5480;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-30';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('30-student-school-scope');
const { eq } = rec;
const BASE = 'http://localhost:5987';
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
  const epg = await startEmbeddedPostgres('30-student-school-scope', PG_PORT);
  try {
    runMigrateUp();
    const hash = await hashPassword(PW);
    const one = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id")).id;
    const B = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id")).id;
    const adminA = (await one("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('admin@a.test',$1,'A','company_admin',$2,now()) RETURNING id", [hash, A])).id;
    const adminB = (await one("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('admin@b.test',$1,'B','company_admin',$2,now()) RETURNING id", [hash, B])).id;
    const school = (name, creator = null) => one("INSERT INTO schools(name,claim_status,claimed_at,created_by_user_id) VALUES($1,'claimed',now(),$2) RETURNING id", [name, creator]).then((r) => r.id);
    const withStudents = await school('Linked By Student');
    await pool.query("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,'Existing Kid')", [A, withStudents]);
    const createdByA = await school('Created By A', adminA);
    const onlyB = await school('Only B School');
    await pool.query("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,'B Kid')", [B, onlyB]);
    const createdByB = await school('Created By B', adminB);
    const unrelated = await school('Nobody Links Here');

    const app = createApp();
    const server = app.listen(5987);
    try {
      const tA = await login('admin@a.test');
      const body = (school_id, full_name = 'New Kid') => ({ full_name, grade: '3', age: 8, parent_name: 'P', parent_phone: '555', school_id, street_address: '1 Oak', city: 'Chicago', state: 'IL', zip_code: '60601', notes: 'None' });
      const MSG = "This school isn't linked to your company. Pick one of your schools, or add it as a new school first.";

      console.log('--- linked schools are allowed ---');
      eq('a school where the company already has students -> 201', (await api('POST', '/students', tA, body(withStudents))).status, 201);
      eq('a school the company created (placeholder) -> 201', (await api('POST', '/students', tA, body(createdByA))).status, 201);
      const ph = await api('POST', '/placeholders/school', tA, { name: 'Brand New School', address: '5 Pine St' });
      eq('a new school added right now -> 201', (await api('POST', '/students', tA, body(ph.body.id))).status, 201);

      console.log('\n--- anything else is 403, same message ---');
      for (const [label, id] of [['a school only another company works with', onlyB], ["another company's placeholder", createdByB], ['a school nobody is linked to', unrelated], ['an id that does not exist', '00000000-0000-0000-0000-000000000000']]) {
        const r = await api('POST', '/students', tA, body(id, 'Planted'));
        eq(`${label} -> 403 with the clear message`, `${r.status} ${r.body?.error}`, `403 ${MSG}`);
      }
      eq('a malformed school id -> 400', (await api('POST', '/students', tA, body('not-a-uuid'))).status, 400);
      eq('no student was planted anywhere', (await pool.query("SELECT count(*)::int AS n FROM students WHERE full_name='Planted'")).rows[0].n, 0);
      eq("the other company's school detail stays hidden", (await api('GET', `/schools/${onlyB}`, tA)).status, 404);

      console.log('\n--- the import follows the same rule ---');
      const row = (school) => ({ full_name: 'Import Kid', school, grade: '2', age: '7', parent_name: 'P', parent_phone: '555', street_address: '1 Oak', city: 'Chicago', state: 'IL', zip_code: '60601' });
      const pv = await api('POST', '/imports/preview', tA, { type: 'students', rows: [row('Only B School'), row('Nobody Links Here'), row('Created By B'), row('Created By A')] });
      eq('import preview: unlinked schools are row errors, a linked one is created', pv.body.rows.map((r) => r.action).join(), 'error,error,error,create');
      eq('the row error names the school', /School "Only B School" was not found/.test(pv.body.rows[0].reason), true);
      const cm = await api('POST', '/imports/commit', tA, { type: 'students', rows: [row('Only B School'), row('Created By A')] });
      eq('import commit writes only the linked row', JSON.stringify(cm.body.counts), '{"created":1,"updated":0,"error":1}');
      eq("nothing was written at company B's school", (await pool.query('SELECT count(*)::int AS n FROM students WHERE school_id=$1 AND company_id=$2', [onlyB, A])).rows[0].n, 0);
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
