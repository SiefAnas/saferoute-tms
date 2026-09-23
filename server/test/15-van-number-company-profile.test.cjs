// MVP finish: van fleet number (vans.number) and company email/city (companies.email/city).
// Create / update / read, validation, and that one company can't see or touch another's.
const PG_PORT = 5465;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-15';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('15-van-number-company-profile');
const { ok, bad, eq } = rec;
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));
const BASE = 'http://localhost:5500';
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
  const epg = await startEmbeddedPostgres('15-van-number-company-profile', PG_PORT);
  let server;
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const B = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id");
    await ins("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('a@co.com',$1,'Admin A','company_admin',$2,now()) RETURNING id", [hash, A.id]);
    await ins("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('b@co.com',$1,'Admin B','company_admin',$2,now()) RETURNING id", [hash, B.id]);
    const driverA = await ins("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('d@co.com',$1,'Driver A','driver',$2,now()) RETURNING id", [hash, A.id]);

    server = createApp().listen(5500);
    const tA = await login('a@co.com');
    const tB = await login('b@co.com');
    const tD = await login('d@co.com');

    console.log('\n--- Van number ---');
    const van = { license_plate: 'VN-1', brand: 'Ford', model: 'Transit', year: 2021, color: 'White' };
    let r = await api('POST', '/vans', tA, { ...van, number: ' 04 ' });
    eq('create with number -> 201', r.status, 201);
    eq('number is trimmed and returned', r.body?.number, '04');
    const v1 = r.body;

    r = await api('POST', '/vans', tA, { ...van, license_plate: 'VN-2' });
    eq('create without number -> 201', r.status, 201);
    eq('number defaults to null', r.body?.number, null);
    const v2 = r.body;

    r = await api('POST', '/vans', tA, { ...van, license_plate: 'VN-3', number: '04' });
    eq('duplicate number in the same company -> 409', r.status, 409);

    r = await api('POST', '/vans', tA, { ...van, license_plate: 'VN-4', number: '12345678901' });
    eq('number over 10 chars -> 400', r.status, 400);

    r = await api('PATCH', `/vans/${v2.id}`, tA, { number: '07' });
    eq('update number -> 200', r.status, 200);
    eq('updated number returned', r.body?.number, '07');

    r = await api('PATCH', `/vans/${v2.id}`, tA, { number: '04' });
    eq('update to a number another van has -> 409', r.status, 409);

    r = await api('PATCH', `/vans/${v1.id}`, tA, { number: '' });
    eq('blank number clears it -> 200', r.status, 200);
    eq('cleared number is null', r.body?.number, null);

    r = await api('GET', `/vans/${v2.id}`, tA);
    eq('GET /vans/:id returns number', r.body?.number, '07');
    // A driver reads only vans on their own not-ended assignments (access-scope rule).
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School','claimed',now()) RETURNING id");
    const kid = await ins("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,'Kid') RETURNING id", [A.id, S.id]);
    await ins("INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date) VALUES($1,$2,$3,$4,'2020-01-01') RETURNING id", [A.id, kid.id, driverA.id, v2.id]);
    r = await api('GET', '/vans', tD);
    check(r.status === 200 && r.body.some((v) => v.number === '07'), "driver can read the number of their own assignment's van");
    check(r.status === 200 && !r.body.some((v) => v.id === v1.id), "driver's van list leaves out vans not on their assignments");

    r = await api('POST', '/vans', tB, { ...van, license_plate: 'VN-B1', number: '07' });
    eq('another company can reuse the same number', r.status, 201);

    r = await api('GET', '/vans', tB);
    check(r.status === 200 && !r.body.some((v) => v.id === v2.id), "company B's list doesn't include company A's van");
    r = await api('GET', `/vans/${v2.id}`, tB);
    eq("company B can't read company A's van", r.status, 404);
    r = await api('PATCH', `/vans/${v2.id}`, tB, { number: '99' });
    eq("company B can't change company A's van number", r.status, 404);
    r = await api('GET', `/vans/${v2.id}`, tA);
    eq("company A's number is unchanged after B's attempt", r.body?.number, '07');

    r = await api('PATCH', `/vans/${v2.id}`, tD, { number: '55' });
    eq("a driver can't change a van number", r.status, 403);

    console.log('\n--- Company email and city ---');
    r = await api('GET', '/companies/me', tA);
    check(r.status === 200 && r.body.email === null && r.body.city === null, 'email/city start null');

    r = await api('PATCH', '/companies/me', tA, { email: 'office@coa.com', city: ' Springfield ' });
    eq('update email + city -> 200', r.status, 200);
    eq('email saved', r.body?.email, 'office@coa.com');
    eq('city saved (trimmed)', r.body?.city, 'Springfield');

    r = await api('PATCH', '/companies/me', tA, { email: 'not-an-email' });
    eq('invalid email -> 400', r.status, 400);

    r = await api('GET', '/companies/me', tB);
    check(r.status === 200 && r.body.id === B.id && r.body.email === null, "company B only sees its own company, not A's email");

    r = await api('PATCH', '/companies/me', tB, { city: 'Shelbyville' });
    eq('company B updates its own city', r.status, 200);
    r = await api('GET', '/companies/me', tA);
    eq("company A's city is untouched by B's update", r.body?.city, 'Springfield');

    r = await api('PATCH', '/companies/me', tA, { email: '', city: '' });
    check(r.status === 200 && r.body.email === null && r.body.city === null, 'blank email/city clears them');

    r = await api('GET', '/companies/me', tD);
    eq("a driver can't read the company profile endpoint", r.status, 403);
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
