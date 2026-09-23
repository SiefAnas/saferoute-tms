// Regression: a parent token must not reach the company-wide resource routers. Before the fix,
// GET /students as a parent listed every student in the company (another family's child, home
// address, guardian phone, notes), and /trips, /sessions, /assignments, /vans were open too.
// Parents only use /parent/*.
const PG_PORT = 5466;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-16';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('16-parent-scope');
const { ok, bad, eq } = rec;
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));
const BASE = 'http://localhost:5600';
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
  const epg = await startEmbeddedPostgres('16-parent-scope', PG_PORT);
  let server;
  try {
    runMigrateUp();
    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const C = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School','claimed',now()) RETURNING id");
    await ins("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('admin@co.com',$1,'Admin','company_admin',$2,now())", [hash, C.id]);
    const D = await ins("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('driver@co.com',$1,'Driver','driver',$2,now()) RETURNING id", [hash, C.id]);
    const P = await ins("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('parent@co.com',$1,'Parent','parent',$2,now()) RETURNING id", [hash, C.id]);
    const mine = await ins("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,'My Child') RETURNING id", [C.id, S.id]);
    const other = await ins("INSERT INTO students(company_id,school_id,full_name,street_address) VALUES($1,$2,'Other Family Child','9 Private Ln') RETURNING id", [C.id, S.id]);
    await ins('INSERT INTO parent_students(parent_user_id,student_id,company_id) VALUES($1,$2,$3) RETURNING id', [P.id, mine.id, C.id]);

    server = createApp().listen(5600);
    const tP = await login('parent@co.com');
    const tA = await login('admin@co.com');
    const tD = await login('driver@co.com');

    console.log('\n--- Parent is kept off company-wide routers ---');
    for (const path of ['/students', `/students/${other.id}`, '/trips', '/sessions', '/assignments', '/vans']) {
      const r = await api('GET', path, tP);
      eq(`parent GET ${path} -> 403`, r.status, 403);
      check(!JSON.stringify(r.body ?? '').includes('Private Ln'), `parent GET ${path} leaks no other-family data`);
    }
    eq('parent POST /trips -> 403', (await api('POST', '/trips', tP, { student_id: mine.id, trip_type: 'pickup', shift_period: 'morning' })).status, 403);
    eq('parent POST /sessions/checkin -> 403', (await api('POST', '/sessions/checkin', tP, { shift_period: 'morning' })).status, 403);

    console.log('\n--- Parent portal still works, and only shows their own child ---');
    const kids = await api('GET', '/parent/students', tP);
    check(kids.status === 200 && kids.body.length === 1 && kids.body[0].id === mine.id, 'GET /parent/students -> only their linked child');
    eq('GET /parent/students/:id/detail for own child -> 200', (await api('GET', `/parent/students/${mine.id}/detail`, tP)).status, 200);
    eq("GET /parent/students/:id/detail for another family's child -> 404", (await api('GET', `/parent/students/${other.id}/detail`, tP)).status, 404);

    console.log('\n--- Other roles unaffected ---');
    const aStudents = await api('GET', '/students', tA);
    check(aStudents.status === 200 && aStudents.body.length === 2, 'company admin still lists all company students');
    eq('driver GET /sessions -> 200', (await api('GET', '/sessions', tD)).status, 200);
    eq('driver GET /vans -> 200', (await api('GET', '/vans', tD)).status, 200);
    eq('driver GET /students/:id -> 200', (await api('GET', `/students/${mine.id}`, tD)).status, 200);
    void D;
  } finally {
    if (server) server.close();
    try { await pool.end(); } catch { /* already ended */ }
    await epg.stop();
  }
  const { fail } = rec.summarize();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
