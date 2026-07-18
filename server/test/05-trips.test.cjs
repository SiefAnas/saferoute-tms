// Step 3 (Trips) — two-way confirmation, granted-students sub-scope, 5-min auto-complete,
// and the caveat-#1 regression proving a confirm/sweep race stays benign.
const PG_PORT = 5454;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-05';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const { autoCompleteStaleTrips, confirmTrip } = require('../src/services/trips.js');
const { createScopedDb } = require('../src/db/scoped.js');

const rec = createRecorder('05-trips');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:4500';
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
  const epg = await startEmbeddedPostgres('05-trips', PG_PORT);
  try {
    runMigrateUp();

    const h = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const B = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const driverA = await ins("INSERT INTO users(email,password_hash,full_name,role,company_id,phone,email_verified_at) VALUES('drv@a.com',$1,'Drv','driver',$2,'555-0100',now()) RETURNING id", [h, A.id]);
    await ins("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('adm@a.com',$1,'Adm','company_admin',$2,now()) RETURNING id", [h, A.id]);
    await ins("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('adm@b.com',$1,'AdmB','company_admin',$2,now()) RETURNING id", [h, B.id]);
    const staff1 = await ins("INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('s1@s.com',$1,'Staff1','school_staff',$2,now()) RETURNING id", [h, S.id]);
    await ins("INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('s2@s.com',$1,'Staff2','school_staff',$2,now()) RETURNING id", [h, S.id]);
    const stu1 = await ins("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,'Kid 1') RETURNING id", [A.id, S.id]);
    const stu2 = await ins("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,'Kid 2') RETURNING id", [A.id, S.id]);
    const stuB = await ins("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,'Kid B') RETURNING id", [B.id, S.id]);
    // staff1 is granted student 1 only.
    await ins('INSERT INTO staff_student_access(staff_user_id,student_id,school_id) VALUES($1,$2,$3) RETURNING id', [staff1.id, stu1.id, S.id]);

    const app = createApp();
    const server = app.listen(4500);
    try {
      const drv = await login('drv@a.com');
      const adminA = await login('adm@a.com');
      const adminB = await login('adm@b.com');
      const s1 = await login('s1@s.com');
      const s2 = await login('s2@s.com');

      console.log('--- Logging requires an open shift ---');
      eq('log trip with no open shift -> 409', (await api('POST', '/trips', drv, { student_id: stu1.id, trip_type: 'pickup' })).status, 409);
      const ci = await api('POST', '/sessions/checkin', drv, {});
      eq('driver check-in -> 201', ci.status, 201);

      console.log('\n--- Driver logs trip (= driver confirmation) ---');
      const t1 = await api('POST', '/trips', drv, { student_id: stu1.id, trip_type: 'pickup' });
      (t1.status === 201 && t1.body.status === 'pending' && t1.body.driver_confirmed_at && !t1.body.staff_confirmed_at)
        ? ok('log trip -> 201 pending, driver_confirmed set, staff not') : bad(`log: ${t1.status} ${JSON.stringify(t1.body)}`);
      eq('log-trip response is also enriched with driver contact', t1.body.driver_name, 'Drv');
      const sess = (await api('GET', `/sessions/${ci.body.id}`, drv)).body;
      eq('session.trip_count incremented to 1', sess.trip_count, 1);
      eq('driver logging a student not in their company -> 404', (await api('POST', '/trips', drv, { student_id: stuB.id, trip_type: 'pickup' })).status, 404);

      console.log('\n--- Two-way confirmation ---');
      eq('non-granted staff (staff2) confirms trip for student1 -> 404', (await api('POST', `/trips/${t1.body.id}/confirm`, s2)).status, 404);
      const conf = await api('POST', `/trips/${t1.body.id}/confirm`, s1);
      (conf.status === 200 && conf.body.status === 'complete' && conf.body.staff_confirmed_at && conf.body.auto_completed === false)
        ? ok('granted staff confirms -> complete (both sides, not auto)') : bad(`confirm: ${conf.status} ${JSON.stringify(conf.body)}`);
      eq('confirm response is also enriched with driver contact', conf.body.driver_phone, '555-0100');
      eq('confirming an already-complete trip -> 409', (await api('POST', `/trips/${t1.body.id}/confirm`, s1)).status, 409);

      console.log('\n--- 5-minute auto-complete (backdated, no real waiting) ---');
      const t2 = (await api('POST', '/trips', drv, { student_id: stu2.id, trip_type: 'dropoff' })).body; // never staff-confirmed
      const t3 = (await api('POST', '/trips', drv, { student_id: stu1.id, trip_type: 'dropoff' })).body; // fresh, should NOT sweep
      await pool.query("UPDATE trips SET driver_confirmed_at = now() - interval '6 minutes' WHERE id = $1", [t2.id]);
      const swept = await autoCompleteStaleTrips();
      eq('sweep completes exactly 1 stale trip', swept, 1);
      const t2after = (await pool.query('SELECT status, auto_completed FROM trips WHERE id=$1', [t2.id])).rows[0];
      (t2after.status === 'complete' && t2after.auto_completed === true) ? ok('backdated half-confirmed trip auto-completed (auto_completed=true)') : bad(`t2 after: ${JSON.stringify(t2after)}`);
      const t3after = (await pool.query('SELECT status FROM trips WHERE id=$1', [t3.id])).rows[0];
      eq('fresh pending trip NOT swept', t3after.status, 'pending');

      console.log('\n--- Read sub-scopes ---');
      const staffTrips = (await api('GET', '/trips', s1)).body;
      (staffTrips.every((t) => t.student_id === stu1.id)) ? ok('school_staff sees only granted-student trips') : bad(`staff saw non-granted: ${staffTrips.map((t) => t.student_id)}`);
      (staffTrips.length > 0 && staffTrips.every((t) => t.driver_name === 'Drv' && t.driver_phone === '555-0100'))
        ? ok('trips enriched with driver name + phone for school_staff (§7.4)')
        : bad(`driver contact missing/wrong: ${JSON.stringify(staffTrips.map((t) => ({ n: t.driver_name, p: t.driver_phone })))}`);
      const oneStaffTrip = (await api('GET', `/trips/${staffTrips[0].id}`, s1)).body;
      (oneStaffTrip.driver_name === 'Drv' && oneStaffTrip.driver_phone === '555-0100')
        ? ok('GET /trips/:id also enriched with driver contact') : bad(`single-trip fetch missing driver contact: ${JSON.stringify(oneStaffTrip)}`);
      const drvTrips = (await api('GET', '/trips', drv)).body;
      eq('driver sees own 3 trips', drvTrips.length, 3);
      const adminTrips = (await api('GET', '/trips', adminA)).body;
      eq('company_admin sees all 3 company trips', adminTrips.length, 3);
      eq('company B admin sees 0 trips (isolation)', (await api('GET', '/trips', adminB)).body.length, 0);
      eq('staff2 (no grants) sees 0 trips', (await api('GET', '/trips', s2)).body.length, 0);

      console.log('\n--- [caveat #1 regression] staff confirm racing the sweep stays benign ---');
      // Fresh pending trip for the granted student.
      const tr = (await api('POST', '/trips', drv, { student_id: stu1.id, trip_type: 'pickup' })).body;
      // Build the real staff scoped accessor, but wrap findById so the sweep lands in the exact
      // gap between confirmTrip's read (sees 'pending') and its update.
      const baseDb = createScopedDb(pool, { type: 'school', id: S.id }, { userId: staff1.id, role: 'school_staff' });
      const racingDb = {
        ...baseDb,
        findById: async (table, id, opts) => {
          const snapshot = await baseDb.findById(table, id, opts); // reads 'pending'
          await pool.query("UPDATE trips SET driver_confirmed_at = now() - interval '6 minutes' WHERE id = $1", [id]);
          await autoCompleteStaleTrips(); // sweep completes it right now
          return snapshot; // confirmTrip proceeds believing it's still pending
        },
      };
      const staffReq = { auth: { role: 'school_staff', userId: staff1.id, tenantType: 'school', tenantId: S.id }, db: racingDb };
      // Now that the race is fixed (status='pending' guard on the update), confirmTrip must
      // deterministically throw 409 rather than silently overwrite the already-swept row.
      let raced = null;
      try { await confirmTrip(staffReq, tr.id); bad('confirmTrip did not throw despite losing the race to the sweep'); }
      catch (e) { raced = e; }
      (raced && raced.status === 409 && /already complete/.test(raced.message))
        ? ok('confirmTrip on an already-swept trip -> 409 "trip already complete" (deterministic, not silent)')
        : bad(`unexpected error: ${raced ? `${raced.status} ${raced.message}` : 'none'}`);
      const fin = (await pool.query(
        'SELECT status, auto_completed, driver_confirmed_at, staff_confirmed_at FROM trips WHERE id = $1', [tr.id]
      )).rows[0];
      (fin.status === 'complete' && fin.auto_completed === true && fin.driver_confirmed_at !== null && fin.staff_confirmed_at === null)
        ? ok('post-race end state: complete via the sweep, staff_confirmed_at correctly NOT set by the blocked confirm')
        : bad(`unexpected end state: ${JSON.stringify(fin)}`);
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
