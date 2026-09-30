// Deleting a student with trip history, or a van any assignment ever used, answered 500 (raw
// foreign-key error). Now it is a 409 that says what blocks it and what to do instead; nothing is
// deleted. Records without history still delete (204), and another company's id is still 404.
const PG_PORT = 5481;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-31';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('31-delete-conflicts');
const { eq } = rec;
const BASE = 'http://localhost:5988';
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
const exists = async (table, id) => (await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rows.length === 1;

async function main() {
  const epg = await startEmbeddedPostgres('31-delete-conflicts', PG_PORT);
  try {
    runMigrateUp();
    const hash = await hashPassword(PW);
    const one = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id")).id;
    const B = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id")).id;
    const S = (await one("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School','claimed',now()) RETURNING id")).id;
    await pool.query("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('admin@a.test',$1,'A','company_admin',$2,now()),('admin@b.test',$1,'B','company_admin',$3,now())", [hash, A, B]);
    const driver = (await one("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('drv@a.test',$1,'D','driver',$2,now()) RETURNING id", [hash, A])).id;
    const student = (name) => one('INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,$3) RETURNING id', [A, S, name]).then((r) => r.id);
    const van = (plate) => one("INSERT INTO vans(company_id,license_plate,brand,model,year,color) VALUES($1,$2,'Ford','T',2022,'White') RETURNING id", [A, plate]).then((r) => r.id);

    const withTrips = await student('Has Trips');
    const withChange = await student('Has Schedule Change');
    const clean = await student('No History');
    const usedVanCurrent = await van('CUR-1');
    const usedVanPast = await van('PAST-1');
    const freeVan = await van('FREE-1');
    await pool.query("INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date) VALUES($1,$2,$3,$4,'2020-01-01')", [A, withTrips, driver, usedVanCurrent]);
    await pool.query("INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,end_date) VALUES($1,$2,$3,$4,'2020-01-01','2020-06-30')", [A, withChange, driver, usedVanPast]);
    const sess = (await one("INSERT INTO sessions(user_id,company_id,shift_period) VALUES($1,$2,'morning') RETURNING id", [driver, A])).id;
    for (const t of ['pickup', 'dropoff']) {
      await pool.query("INSERT INTO trips(session_id,company_id,student_id,school_id,trip_type,shift_period,status) VALUES($1,$2,$3,$4,$5,'morning','complete')", [sess, A, withTrips, S, t]);
    }
    const staff = (await one("INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('staff@s.test',$1,'St','school_staff',$2,now()) RETURNING id", [hash, S])).id;
    await pool.query("INSERT INTO schedule_changes(company_id,school_id,student_id,change_type,reported_by_user_id) VALUES($1,$2,$3,'left_early',$4)", [A, S, withChange, staff]);

    const app = createApp();
    const server = app.listen(5988);
    try {
      const tA = (await api('POST', '/auth/login', null, { email: 'admin@a.test', password: PW })).body.token;
      const tB = (await api('POST', '/auth/login', null, { email: 'admin@b.test', password: PW })).body.token;

      console.log('--- students ---');
      const s1 = await api('DELETE', `/students/${withTrips}`, tA);
      eq('student with trips -> 409 (not 500)', `${s1.status} ${s1.body?.code}`, '409 STUDENT_HAS_HISTORY');
      eq('the message says what blocks it', /2 trips on record/.test(s1.body?.error), true);
      eq('and what to do instead', /can't be deactivated yet.*end their assignments/.test(s1.body?.error), true);
      eq('the student is still there', await exists('students', withTrips), true);
      eq('and so are their assignments (nothing half-deleted)', (await pool.query('SELECT count(*)::int AS n FROM assignments WHERE student_id=$1', [withTrips])).rows[0].n, 1);
      const s2 = await api('DELETE', `/students/${withChange}`, tA);
      eq('student with a schedule change -> 409 naming it', `${s2.status} ${/1 schedule change on record/.test(s2.body?.error)}`, '409 true');
      eq('student without history -> 204', (await api('DELETE', `/students/${clean}`, tA)).status, 204);
      eq('another company deleting it -> 404, not 409 (nothing learned)', (await api('DELETE', `/students/${withTrips}`, tB)).status, 404);

      console.log('\n--- vans ---');
      const v1 = await api('DELETE', `/vans/${usedVanCurrent}`, tA);
      eq('van with a current assignment -> 409', `${v1.status} ${v1.body?.code}`, '409 VAN_HAS_HISTORY');
      eq('the message counts the current assignment and says what to do', /1 current or upcoming assignment.*move current assignments to another van/.test(v1.body?.error), true);
      const v2 = await api('DELETE', `/vans/${usedVanPast}`, tA);
      eq('van used only in the past -> 409 naming the past assignment', `${v2.status} ${/1 past assignment/.test(v2.body?.error)}`, '409 true');
      eq('both vans are still there', `${await exists('vans', usedVanCurrent)} ${await exists('vans', usedVanPast)}`, 'true true');
      eq('van never assigned -> 204', (await api('DELETE', `/vans/${freeVan}`, tA)).status, 204);
      eq('another company deleting a van -> 404', (await api('DELETE', `/vans/${usedVanCurrent}`, tB)).status, 404);
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
