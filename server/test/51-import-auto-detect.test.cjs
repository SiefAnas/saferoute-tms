// The multi-file import end to end: the client's parser and plan (client/src/lib/sheetParse.ts,
// importPlan.ts) on invented "Quincy style" route sheets, sent to the real /imports/preview and
// /imports/commit in dependency order. Checks that the plan's reading of server errors (a school
// or student that is in the same upload) matches what the server actually says, and that a
// student who can't be imported never leaves an assignment behind.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const PG_PORT = 5532;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-51';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('51-import-auto-detect');
// Values here are arrays and objects: compare them as JSON.
const eq = (msg, got, want) => rec.eq(msg, JSON.stringify(got), JSON.stringify(want));
const PORT = 6051;
const BASE = `http://localhost:${PORT}`;
const PW = 'Secret123!';
const CLIENT = path.join(__dirname, '..', '..', 'client');
const load = (p) => import(pathToFileURL(path.join(CLIENT, p)).href);

async function main() {
  const { parseSheet } = await load('src/lib/sheetParse.ts');
  const { buildPlan, checkAll, commitAll, needsOf, studentKey } = await load('src/lib/importPlan.ts');
  const { shapeB, DRIVERS_B, TYPES } = await load('test/fixtures/importShapes.ts');

  const epg = await startEmbeddedPostgres('51-import-auto-detect', PG_PORT);
  try {
    runMigrateUp();
    const hash = await hashPassword(PW);
    const one = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id")).id;
    const admin = (await one("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('admin@a.test',$1,'Admin','company_admin',$2,now()) RETURNING id", [hash, A])).id;
    // The company already has: its drivers, its vans (numbered 1-5), the QHS school and three of
    // the students on Iris's sheet. Everything else comes from the files.
    const drivers = [];
    for (const d of DRIVERS_B) {
      const id = (await one("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES($1,$2,$3,'driver',$4,now()) RETURNING id", [d.email, hash, d.full_name, A])).id;
      drivers.push({ id, full_name: d.full_name, email: d.email });
    }
    const vans = [];
    for (const n of [1, 2, 3, 4, 5]) {
      const v = await one("INSERT INTO vans(company_id,license_plate,brand,model,year,color,number) VALUES($1,$2,'Ford','Transit',2022,'White',$3) RETURNING id, license_plate, number", [A, `TST-10${n}`, String(n)]);
      vans.push(v);
    }
    const qhs = (await one("INSERT INTO schools(name,address,claim_status,created_by_user_id) VALUES('QHS','1 Pretend Blvd, Quincy, MA 02169','unclaimed',$1) RETURNING id", [admin])).id;
    for (const name of ['Quinn Madeup', 'Rory Invent', 'Sage Unreal']) {
      await pool.query("INSERT INTO students(company_id,school_id,full_name,grade,age,parent_name,parent_phone,street_address,city,state,zip_code,notes) VALUES($1,$2,$3,'9',14,'A Parent','555-010-0000','1 Old St','Quincy','MA','02169','None')", [A, qhs, name]);
    }

    const app = createApp();
    const server = app.listen(PORT);
    try {
      const token = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@a.test', password: PW }) })).json()).token;
      const post = async (p, body) => {
        const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(`${p} -> ${r.status} ${await r.text()}`);
        return r.json();
      };

      const ctx = { types: TYPES, drivers, vans, driverVan: {} };
      const raws = Object.entries(shapeB()).map(([name, rows]) => ({ file: 'Quincy_Routes.xlsx', name, rows: rows.map((r) => r.map(String)), firstLine: 1 }));
      const parsed = raws.map((r) => parseSheet(r, ctx));
      const plan = buildPlan(parsed, ctx, { startDate: '2026-11-02', maxRows: 100, knownSchools: ['QHS'] });

      console.log('--- the plan ---');
      eq('one new school (GOAL); QHS is already there', plan.rows.schools.map((s) => s.row.name), ['GOAL']);
      eq('ten students, no duplicates from the repeated sheet', plan.rows.students.length, 10);

      console.log('\n--- check (the real server preview) ---');
      const statuses = await checkAll(plan, post);
      eq('the new school will be created', statuses.schools.map((s) => s.state), ['ready']);
      const st = (name) => statuses.students[plan.rows.students.findIndex((s) => s.row.full_name === name)];
      eq('a student already on file will update', [st('Rory Invent').state, st('Rory Invent').action], ['ready', 'update']);
      // Shape B has no phone column, so a new student is missing that too.
      eq('a new student without age, parent name or phone needs you, with the server\'s reason', [st('Tess Pretend').state, st('Tess Pretend').reason], ['needs', 'Missing: Age, Parent name, Parent phone']);
      const asg = (name) => statuses.assignments[plan.rows.assignments.findIndex((a) => a.row.student_name === name)];
      eq('an assignment for a student on file will be created', asg('Rory Invent').state, 'ready');
      eq("an assignment whose student can't go in is skipped, with why", [asg('Tess Pretend').state, asg('Tess Pretend').reason], ['skipped', 'skipped because the student row above it could not be imported']);
      const needs = needsOf(plan, statuses);
      eq('the GOAL sheet is listed as "could not tell who drives"', needs.some((n) => /sheet "GOAL"/.test(n.what) && /could not tell who drives this sheet/.test(n.why)), true);

      console.log('\n--- commit, in order ---');
      const out = await commitAll(plan, statuses, post);
      eq('counts per type', JSON.stringify(out.counts), '{"schools":1,"students":3,"assignments":3}');
      eq('GOAL was created as an unclaimed school', (await one("SELECT claim_status FROM schools WHERE name='GOAL'")).claim_status, 'unclaimed');
      const rory = await one("SELECT a.shift_period, a.pickup_time, a.dropoff_time, a.days_of_week, u.full_name AS driver, v.license_plate FROM assignments a JOIN students s ON s.id=a.student_id JOIN users u ON u.id=a.driver_user_id JOIN vans v ON v.id=a.van_id WHERE s.full_name='Rory Invent'");
      eq('Rory: Iris, Van 1, afternoon (Drop Off said "Afternoon"), pickup 06:55', [rory.driver, rory.license_plate, rory.shift_period, String(rory.pickup_time).slice(0, 5), rory.dropoff_time], ['Iris Dunn', 'TST-101', 'afternoon', '06:55', null]);
      const stored = await one("SELECT age, parent_name, street_address, student_id FROM students WHERE full_name='Rory Invent'");
      eq('the update kept age and parent name, took the new address and the Student ID', [stored.age, stored.parent_name, stored.street_address, stored.student_id], [14, 'A Parent', '12 Maple St', 'Q-1002']);
      eq("Rory's notes were updated from the file", (await one("SELECT notes FROM students WHERE full_name='Rory Invent'")).notes, 'Car seat; Needs a monitor');
      eq('the copy of Iris\'s sheet made no second assignment', (await one("SELECT count(*)::int AS n FROM assignments a JOIN students s ON s.id=a.student_id WHERE s.full_name='Quinn Madeup'")).n, 1);
      eq('no assignment points at a student that was not imported', (await one("SELECT count(*)::int AS n FROM students WHERE full_name='Tess Pretend'")).n, 0);
      eq('every assignment has its student', (await one('SELECT count(*)::int AS n FROM assignments a LEFT JOIN students s ON s.id=a.student_id WHERE s.id IS NULL')).n, 0);
      // An update may leave parent fields blank, but a NEW parent account still needs a name and phone.
      const parentless = await post('/imports/preview', { type: 'students', rows: [{ full_name: 'Quinn Madeup', school: 'QHS', parent_email: 'new.parent@example.test' }] });
      eq('an update row that would create a parent without name or phone is a row error', [parentless.rows[0].action, parentless.rows[0].reason], ['error', 'Creating the parent account needs a Parent name and a Parent phone in this row.']);
      eq('the plan key for a student is name + school', studentKey('Rory Invent', 'QHS'), 'rory invent|qhs');
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
