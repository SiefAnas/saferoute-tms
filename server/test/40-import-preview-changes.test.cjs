// Import preview shows what each update would change (branch prod-safety-and-import-fix): for
// every row that updates an existing record, the fields whose value would change, with the old and
// the new value; unchanged and blank fields are not listed; a row that replaces a non-empty stored
// value is marked `overwrite`. The preview writes nothing, and the import then writes exactly what
// the preview listed (both use the same patch builders).
const PG_PORT = 5498;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-40';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('40-import-preview-changes');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5998';
const PW = 'Secret123!';
const J = (v) => JSON.stringify(v);

async function main() {
  const epg = await startEmbeddedPostgres('40-import-preview-changes', PG_PORT);
  try {
    runMigrateUp();
    const hash = await hashPassword(PW);
    const q = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await q("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const S = await q("INSERT INTO schools(name,claim_status,claimed_at) VALUES('Elm School','claimed',now()) RETURNING id");
    const admin = await q("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('admin@a.test',$1,'Admin','company_admin',$2,now()) RETURNING id", [hash, A.id]);
    const sAdmin = await q("INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('sadmin@s.test',$1,'SA','school_admin',$2,now()) RETURNING id", [hash, S.id]);
    const driver = await q(
      `INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at,created_by_user_id,phone,address,license_number)
       VALUES('drv@a.test',$1,'Dee Driver','driver',$2,now(),$3,NULL,'4 Road Ln','DRV-1') RETURNING id`, [hash, A.id, admin.id]);
    await q(
      `INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at,created_by_user_id,phone,address)
       VALUES('staff@s.test',$1,'Sam Staff','school_staff',$2,now(),$3,'555-0001','1 School Rd')`, [hash, S.id, sAdmin.id]);
    const kid = await q(
      `INSERT INTO students(company_id,school_id,full_name,grade,age,parent_name,parent_phone,street_address,city,state,zip_code,notes)
       VALUES($1,$2,'Ana Lee','3',8,'Pat','555-0100','1 Elm St','Springfield','IL','62701','Wheelchair: lift van only') RETURNING id`, [A.id, S.id]);
    await q("INSERT INTO vans(company_id,license_plate,brand,model,year,color) VALUES($1,'VAN-1','Ford','Transit',2020,'White')", [A.id]);

    const server = createApp().listen(5998);
    const post = (p, token, body) => fetch(BASE + p, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
    try {
      const tA = (await post('/auth/login', null, { email: 'admin@a.test', password: PW })).body.token;
      const tS = (await post('/auth/login', null, { email: 'sadmin@s.test', password: PW })).body.token;

      console.log('--- drivers: a create, an update that fills one empty field, an overwrite, no change ---');
      const rows = [
        { email: 'new@a.test', full_name: 'New Person', phone: '555-9999' },               // create
        { email: 'drv@a.test', phone: '555-0404' },                                         // fills an empty phone
      ];
      const pv = await post('/imports/preview', tA, { type: 'drivers', rows });
      eq('preview -> 200', pv.status, 200);
      const [create, fill] = pv.body.rows;
      eq('create row: action create, no changes list, not an overwrite', J([create.action, create.changes, create.overwrite]), J(['create', null, false]));
      eq('update that changes one field: exactly that field, old null -> new value', J(fill.changes), J([{ field: 'phone', label: 'Phone', old: null, new: '555-0404' }]));
      eq('...filling an empty value is not an overwrite', fill.overwrite, false);
      eq('...name, address, license (blank in the file) are not listed', fill.changes.map((c) => c.field).join(','), 'phone');

      const pv2 = await post('/imports/preview', tA, { type: 'drivers', rows: [{ email: 'drv@a.test', full_name: 'Dee Driver', address: '9 New Rd', license_number: 'DRV-1' }] });
      const ow = pv2.body.rows[0];
      eq('overwrite row: only the changed field (same name and same license are not listed)', J(ow.changes), J([{ field: 'address', label: 'Address', old: '4 Road Ln', new: '9 New Rd' }]));
      eq('...marked as an overwrite', ow.overwrite, true);
      eq('...and counted', pv2.body.counts.overwrite, 1);
      const same = (await post('/imports/preview', tA, { type: 'drivers', rows: [{ email: 'drv@a.test', full_name: 'Dee Driver' }] })).body.rows[0];
      eq('an update that changes nothing: empty list, not an overwrite', J([same.action, same.changes, same.overwrite]), J(['update', [], false]));

      eq('preview wrote nothing', J(await q('SELECT phone, address FROM users WHERE id = $1', [driver.id])), J({ phone: null, address: '4 Road Ln' }));

      console.log('\n--- the import writes exactly what the preview listed ---');
      const cm = await post('/imports/commit', tA, { type: 'drivers', rows: [{ email: 'drv@a.test', phone: '555-0404', full_name: 'Dee Driver', address: '9 New Rd', license_number: 'DRV-1' }] });
      eq('commit -> 1 updated', cm.body.counts?.updated, 1);
      eq('stored values = the preview\'s "new" values, the rest unchanged', J(await q('SELECT full_name, phone, address, license_number FROM users WHERE id = $1', [driver.id])),
        J({ full_name: 'Dee Driver', phone: '555-0404', address: '9 New Rd', license_number: 'DRV-1' }));

      console.log('\n--- fields the type does not have, and blank cells, are never listed ---');
      const st = (await post('/imports/preview', tS, { type: 'staff', rows: [{ email: 'staff@s.test', full_name: 'Sam Staff', phone: '' }] })).body.rows[0];
      eq('staff: no address change listed (the staff type has no address), blank phone not listed', J([st.changes, st.overwrite]), J([[], false]));

      console.log('\n--- students: the safety note ---');
      const student = (extra) => ({ full_name: 'Ana Lee', school: 'Elm School', grade: '3', age: '8', parent_name: 'Pat', parent_phone: '555-0100', street_address: '1 Elm St', city: 'Springfield', state: 'IL', zip_code: '62701', ...extra });
      const keep = (await post('/imports/preview', tA, { type: 'students', rows: [student({})] })).body.rows[0];
      eq('no Notes column: the note is not listed (it is left alone)', J([keep.action, keep.changes, keep.overwrite]), J(['update', [], false]));
      const repl = (await post('/imports/preview', tA, { type: 'students', rows: [student({ notes: 'None', grade: '4' })] })).body.rows[0];
      eq('a file that really says "None": both changes listed with old and new', J(repl.changes), J([
        { field: 'grade', label: 'Grade', old: '3', new: '4' },
        { field: 'notes', label: 'Notes', old: 'Wheelchair: lift van only', new: 'None' },
      ]));
      eq('...and the row is marked as an overwrite', repl.overwrite, true);
      eq('preview wrote nothing to the student', (await q('SELECT notes FROM students WHERE id = $1', [kid.id])).notes, 'Wheelchair: lift van only');

      console.log('\n--- vans ---');
      const van = (await post('/imports/preview', tA, { type: 'vans', rows: [{ license_plate: 'VAN-1', brand: 'Ford', model: 'Transit', year: '2021', color: '' }] })).body.rows[0];
      eq('van: year 2020 -> 2021 listed (number compared as text), blank color not listed', J(van.changes), J([{ field: 'year', label: 'Year', old: '2020', new: '2021' }]));
      eq('...overwrite', van.overwrite, true);

      const errRow = (await post('/imports/preview', tA, { type: 'drivers', rows: [{ email: 'not-an-email', full_name: 'X' }] })).body.rows[0];
      eq('error rows: no changes list, not an overwrite', J([errRow.action, errRow.changes, errRow.overwrite]), J(['error', null, false]));
      ok('done');
    } finally {
      server.close();
    }
  } catch (e) {
    bad(`unexpected: ${e.stack}`);
  } finally {
    try { await pool.end(); } catch { /* already ended */ }
    await epg.stop();
  }
  const { fail } = rec.summarize();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
