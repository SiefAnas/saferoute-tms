// The Assignments import type: the last step of the import order, tying students to a driver and a
// van. A row is matched to the student's current assignment: none -> create, same driver and van ->
// update, a different driver or van -> the current one ends and a new one starts, in one
// transaction, and the preview shows it as an overwrite. Uses the same rules as POST /assignments.
const PG_PORT = 5531;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-50';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('50-import-assignments');
const { eq } = rec;
const PORT = 6050;
const BASE = `http://localhost:${PORT}`;
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
const actions = (res) => res.body.rows.map((r) => r.action).join();
const reasons = (res) => res.body.rows.map((r) => r.reason);
const ymd = (d) => (d == null ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);

async function main() {
  const epg = await startEmbeddedPostgres('50-import-assignments', PG_PORT);
  try {
    runMigrateUp();
    const hash = await hashPassword(PW);
    const one = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id")).id;
    const B = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id")).id;
    const S = (await one("INSERT INTO schools(name,claim_status,claimed_at) VALUES('Lakeside Prep','claimed',now()) RETURNING id")).id;
    const user = (email, name, role, company, school = null, active = true) => one(
      'INSERT INTO users(email,password_hash,full_name,role,company_id,school_id,email_verified_at,is_active) VALUES($1,$2,$3,$4,$5,$6,now(),$7) RETURNING id',
      [email, hash, name, role, company, school, active]
    ).then((r) => r.id);
    await user('admin@a.test', 'Admin A', 'company_admin', A);
    const jerry = await user('jerry@a.test', 'Jerry Elas', 'driver', A);
    const jamar = await user('jamar@a.test', 'Jamar Espeut', 'driver', A);
    // Two drivers with no van yet, for the conflict cases below.
    const kai = await user('kai@a.test', 'Kai Free', 'driver', A);
    await user('lou@a.test', 'Lou Free', 'driver', A);
    await user('gone@a.test', 'Gone Driver', 'driver', A, null, false);
    await user('mon@a.test', 'Mo Nitor', 'monitor', A);
    const bDriver = await user('bdriver@b.test', 'B Driver', 'driver', B);
    await user('sadmin@s.test', 'School Admin', 'school_admin', null, S);
    const van = (company, plate) => one("INSERT INTO vans(company_id,license_plate,brand,model,year,color) VALUES($1,$2,'Ford','Transit',2022,'White') RETURNING id", [company, plate]).then((r) => r.id);
    const v111 = await van(A, 'A-111');
    const v222 = await van(A, 'A-222');
    await van(A, 'A-333');
    const vB = await van(B, 'B-999');
    const kid = (name) => one("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,$3) RETURNING id", [A, S, name]).then((r) => r.id);
    const ava = await kid('Ava Kim');
    const ben = await kid('Ben Lee');
    const cara = await kid('Cara Diaz');
    await kid('Dev Patel');
    await kid('Eli Ross');
    const ofStudent = (id) => pool.query('SELECT * FROM assignments WHERE student_id = $1 ORDER BY start_date', [id]).then((r) => r.rows);
    const total = async () => (await one('SELECT count(*)::int AS n FROM assignments')).n;

    const app = createApp();
    const server = app.listen(PORT);
    try {
      const tA = await login('admin@a.test');
      const tS = await login('sadmin@s.test');
      const row = (student_name, extra = {}) => ({ student_name, school: 'Lakeside Prep', driver_email: 'jerry@a.test', van_plate: 'A-111', start_date: '2026-09-01', ...extra });

      console.log('--- who can import assignments ---');
      const typesA = (await api('GET', '/imports/types', tA)).body.types.map((t) => t.id);
      eq('company_admin: assignments is the last type', typesA[typesA.length - 1], 'assignments');
      eq('school_admin: assignments is not offered', (await api('GET', '/imports/types', tS)).body.types.some((t) => t.id === 'assignments'), false);
      eq('school_admin: preview type=assignments -> 403', (await api('POST', '/imports/preview', tS, { type: 'assignments', rows: [row('Ava Kim')] })).status, 403);
      eq('school_admin: commit type=assignments -> 403', (await api('POST', '/imports/commit', tS, { type: 'assignments', rows: [row('Ava Kim')] })).status, 403);
      eq('nothing was written', await total(), 0);

      console.log('\n--- a clean file creates assignments ---');
      const file = [
        row('Ava Kim', { days_of_week: 'Mon,Wed,Fri' }),
        row('Ben Lee', { days_of_week: '1,3,5', shift_period: 'Morning' }),
        row('Cara Diaz', { pickup_time: '7:30 AM' }),
      ];
      const pv = await api('POST', '/imports/preview', tA, { type: 'assignments', rows: file });
      eq('preview: three creates', actions(pv), 'create,create,create');
      eq('preview wrote nothing', await total(), 0);
      const cm = await api('POST', '/imports/commit', tA, { type: 'assignments', rows: file });
      eq('commit: 3 created', JSON.stringify(cm.body.counts), '{"created":3,"updated":0,"error":0}');
      const [a1] = await ofStudent(ava);
      const [b1] = await ofStudent(ben);
      const [c1] = await ofStudent(cara);
      eq('Mon,Wed,Fri lands as [1,3,5]', JSON.stringify(a1.days_of_week), '[1,3,5]');
      eq('1,3,5 lands as [1,3,5]', JSON.stringify(b1.days_of_week), '[1,3,5]');
      eq('empty days becomes Monday to Friday', JSON.stringify(c1.days_of_week), '[1,2,3,4,5]');
      eq('empty shift becomes both', a1.shift_period, 'both');
      eq('Morning (any case) is morning', b1.shift_period, 'morning');
      eq('7:30 AM is stored as 07:30', String(c1.pickup_time).slice(0, 5), '07:30');
      eq('driver, van, start date and open end', [a1.driver_user_id === jerry, a1.van_id === v111, ymd(a1.start_date), a1.end_date].join(), 'true,true,2026-09-01,');

      console.log('\n--- re-importing the same file updates, does not duplicate ---');
      const again = file.map((r) => (r.student_name === 'Cara Diaz' ? { ...r, dropoff_time: '15:05' } : r));
      const pv2 = await api('POST', '/imports/preview', tA, { type: 'assignments', rows: again });
      eq('preview: three updates', actions(pv2), 'update,update,update');
      eq("Cara's preview lists the dropoff change", JSON.stringify(pv2.body.rows[2].changes.map((c) => [c.field, c.old, c.new])), '[["dropoff_time",null,"15:05"]]');
      eq('a filled-in empty value is not an overwrite', pv2.body.rows[2].overwrite, false);
      const cm2 = await api('POST', '/imports/commit', tA, { type: 'assignments', rows: again });
      eq('commit: 3 updated', JSON.stringify(cm2.body.counts), '{"created":0,"updated":3,"error":0}');
      eq('still three assignments', await total(), 3);
      eq('dropoff updated', String((await ofStudent(cara))[0].dropoff_time).slice(0, 5), '15:05');
      eq('a blank cell left the stored pickup alone', String((await ofStudent(cara))[0].pickup_time).slice(0, 5), '07:30');
      eq('a blank shift on update left morning alone (no default applied)', (await ofStudent(ben))[0].shift_period, 'morning');

      console.log('\n--- a different driver is a reassignment, shown as an overwrite ---');
      const move = [row('Ava Kim', { driver_email: 'jamar@a.test', van_plate: 'A-222', start_date: '2026-11-01', days_of_week: 'Mon,Wed,Fri' })];
      const pv3 = await api('POST', '/imports/preview', tA, { type: 'assignments', rows: move });
      eq('preview: an update, not a quiet create', actions(pv3), 'update');
      eq('preview flags it as an overwrite', pv3.body.rows[0].overwrite, true);
      eq('preview shows driver and van old -> new', JSON.stringify(pv3.body.rows[0].changes.map((c) => `${c.label}: ${c.old} -> ${c.new}`)), '["Driver: Jerry Elas -> Jamar Espeut","Van: A-111 -> A-222"]');
      eq('preview says what happens to the current one', pv3.body.rows[0].note, 'Ends the current assignment on 2026-10-31 and starts the new one on 2026-11-01');
      eq('counted as an overwrite', pv3.body.counts.overwrite, 1);
      const cm3 = await api('POST', '/imports/commit', tA, { type: 'assignments', rows: move });
      eq('commit: 1 updated', JSON.stringify(cm3.body.counts), '{"created":0,"updated":1,"error":0}');
      const avaRows = await ofStudent(ava);
      eq('Ava now has the old one (ended) and the new one', avaRows.length, 2);
      eq('the old one ends the day before', [avaRows[0].driver_user_id === jerry, ymd(avaRows[0].end_date)].join(), 'true,2026-10-31');
      eq('the new one is Jamar on A-222 from 2026-11-01, open', [avaRows[1].driver_user_id === jamar, avaRows[1].van_id === v222, ymd(avaRows[1].start_date), avaRows[1].end_date].join(), 'true,true,2026-11-01,');

      console.log('\n--- the reassignment is one transaction ---');
      // Make the insert of the new assignment fail at commit time (after the old one was ended).
      await pool.query(`CREATE FUNCTION test_block_2031() RETURNS trigger AS $$ BEGIN
        IF NEW.start_date = DATE '2031-01-05' THEN RAISE EXCEPTION 'blocked for test'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
      await pool.query('CREATE TRIGGER test_block_2031 BEFORE INSERT ON assignments FOR EACH ROW EXECUTE FUNCTION test_block_2031()');
      const benMove = [row('Ben Lee', { driver_email: 'jamar@a.test', van_plate: 'A-222', start_date: '2031-01-05', shift_period: 'morning', days_of_week: '1,3,5' })];
      eq('preview: a reassignment', actions(await api('POST', '/imports/preview', tA, { type: 'assignments', rows: benMove })), 'update');
      const cm4 = await api('POST', '/imports/commit', tA, { type: 'assignments', rows: benMove });
      eq('commit: the row fails', JSON.stringify(cm4.body.counts), '{"created":0,"updated":0,"error":1}');
      const benRows = await ofStudent(ben);
      eq("Ben's current assignment was NOT ended (rolled back)", [benRows.length, benRows[0].end_date].join(), '1,');
      await pool.query('DROP TRIGGER test_block_2031 ON assignments; DROP FUNCTION test_block_2031()');

      console.log('\n--- unknown student, driver, van; deactivated or non-driver; other company ---');
      const bad = await api('POST', '/imports/preview', tA, { type: 'assignments', rows: [
        row('Nobody Here'),
        row('Dev Patel', { driver_email: 'ghost@a.test' }),
        row('Dev Patel', { van_plate: 'ZZZ-000' }),
        row('Dev Patel', { driver_email: 'gone@a.test' }),
        row('Dev Patel', { driver_email: 'mon@a.test' }),
        row('Dev Patel', { driver_email: 'bdriver@b.test' }),
        row('Dev Patel', { van_plate: 'B-999' }),
        row('Dev Patel', { school: 'No Such School' }),
      ] });
      eq('all eight are errors', actions(bad), 'error,error,error,error,error,error,error,error');
      const r = reasons(bad);
      eq('unknown student', r[0], 'No student named "Nobody Here" at Lakeside Prep. Import the students first.');
      eq('unknown driver email', r[1], 'No driver in your company has the email ghost@a.test.');
      eq('unknown van plate', r[2], 'No van in your company has the license plate ZZZ-000.');
      eq('deactivated driver', r[3], "Gone Driver's account is deactivated. Reactivate it before assigning students to them.");
      eq('not a driver account', r[4], 'Mo Nitor has a monitor account, not a driver account.');
      eq("another company's driver reads as not found", r[5], 'No driver in your company has the email bdriver@b.test.');
      eq("another company's van reads as not found", r[6], 'No van in your company has the license plate B-999.');
      eq('unknown school', r[7], 'School "No Such School" was not found. Import your schools first (Import, then Schools).');
      const cross = await api('POST', '/imports/commit', tA, { type: 'assignments', rows: [row('Dev Patel', { driver_email: 'bdriver@b.test' }), row('Eli Ross', { van_plate: 'B-999' })] });
      eq('commit with foreign driver/van: both errors', JSON.stringify(cross.body.counts), '{"created":0,"updated":0,"error":2}');
      eq('no assignment uses the other company\'s driver or van', (await one('SELECT count(*)::int AS n FROM assignments WHERE driver_user_id = $1 OR van_id = $2', [bDriver, vB])).n, 0);

      console.log('\n--- bad date, time, shift, days ---');
      const fmt = await api('POST', '/imports/preview', tA, { type: 'assignments', rows: [
        row('Dev Patel', { start_date: '2026-02-30' }),
        row('Dev Patel', { start_date: '46000' }),
        row('Dev Patel', { pickup_time: '25:00' }),
        row('Dev Patel', { pickup_time: '0.3125' }),
        row('Dev Patel', { shift_period: 'evening' }),
        row('Dev Patel', { days_of_week: 'Mon,Funday' }),
        row('Dev Patel', { end_date: '2026-08-01' }),
        row('Dev Patel', { start_date: '9/1/2026', days_of_week: 'monday tuesday' }),
      ] });
      eq('seven errors, and a US date with day names is fine', actions(fmt), 'error,error,error,error,error,error,error,create');
      const fr = reasons(fmt);
      eq('not a real date', fr[0], 'Start date "2026-02-30" must be a real date, like 2026-09-01 or 9/1/2026');
      eq('Excel date serial is refused with a hint', fr[1], 'Start date "46000" looks like a spreadsheet date number. Format the column as a date, like 2026-09-01, and export again.');
      eq('bad time', fr[2], 'Pickup time "25:00" must be a time, like 07:30, 15:05 or 3:05 PM');
      eq('Excel time serial is refused with a hint', /spreadsheet time number/.test(fr[3]), true);
      eq('bad shift', fr[4], 'Shift "evening" must be morning, afternoon or both');
      eq('bad day', fr[5], 'Days: "Funday" is not a weekday. Use names like Mon,Wed,Fri or numbers 1 (Monday) to 7 (Sunday).');
      eq('end before start', fr[6], 'End date is before the start date');

      console.log('\n--- two rows for the same student ---');
      const dup = await api('POST', '/imports/preview', tA, { type: 'assignments', rows: [row('Dev Patel'), row('Dev Patel', { start_date: '2026-10-01', van_plate: 'A-111' }), row('Eli Ross')] });
      eq('both rows for Dev are errors, Eli is fine', actions(dup), 'error,error,create');
      eq('duplicate reason', /^Duplicate student/.test(dup.body.rows[0].reason), true);
      const split = await api('POST', '/imports/preview', tA, { type: 'assignments', rows: [row('Dev Patel', { shift_period: 'morning' }), row('Dev Patel', { shift_period: 'afternoon', driver_email: 'kai@a.test', van_plate: 'A-333' })] });
      eq('a morning row and an afternoon row for one student are not duplicates', actions(split), 'create,create');

      console.log('\n--- conflicts use the same rules as POST /assignments ---');
      const vanClash = await api('POST', '/imports/preview', tA, { type: 'assignments', rows: [row('Eli Ross', { driver_email: 'jamar@a.test', van_plate: 'A-111', start_date: '2026-12-01' })] });
      eq('a van already driven by another driver: row error', vanClash.body.rows[0].reason, 'That van is already assigned to a different driver during this date range.');
      const inFile = await api('POST', '/imports/preview', tA, { type: 'assignments', rows: [row('Dev Patel', { driver_email: 'kai@a.test', van_plate: 'A-333', start_date: '2027-01-04' }), row('Eli Ross', { driver_email: 'lou@a.test', van_plate: 'A-333', start_date: '2027-01-04' })] });
      eq('a conflict between two rows of the same file is caught in the preview', actions(inFile), 'create,error');
      const routeClash = await api('POST', '/assignments', tA, { student_id: ava, driver_user_id: kai, van_id: (await one("SELECT id FROM vans WHERE license_plate='A-333'")).id, start_date: '2026-12-01' });
      eq('the route gives the same message for the same conflict', `${routeClash.status} ${routeClash.body?.error}`, '409 That student already has a different driver assigned for an overlapping shift during this date range.');
      const routeGone = await api('POST', '/assignments', tA, { student_id: ava, driver_user_id: (await one("SELECT id FROM users WHERE email='gone@a.test'")).id, van_id: v222, start_date: '2030-01-01' });
      eq('the route refuses a deactivated driver with the same message', `${routeGone.status} ${routeGone.body?.error}`, "400 Gone Driver's account is deactivated. Reactivate it before assigning students to them.");
      const routeShift = await api('POST', '/assignments', tA, { student_id: ava, driver_user_id: jamar, van_id: v222, start_date: '2030-01-01', shift_period: 'evening' });
      eq('the route refuses a bad shift', routeShift.status, 400);

      console.log('\n--- a student missing from the file is left alone ---');
      const before = await total();
      await api('POST', '/imports/commit', tA, { type: 'assignments', rows: [row('Eli Ross', { van_plate: 'A-111' })] });
      eq('only Eli was added; nothing was ended or removed', [await total(), (await one('SELECT count(*)::int AS n FROM assignments WHERE end_date IS NOT NULL')).n].join(), `${before + 1},1`);
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
