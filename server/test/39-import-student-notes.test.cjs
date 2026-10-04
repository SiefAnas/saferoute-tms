// Student notes on import (branch prod-safety-and-import-fix). Notes are where staff record
// disability and safety information. execStudent used `notes: row.notes || 'None'` for updates too,
// so a blank Notes cell (or no Notes column at all) became the string 'None', passed
// updateFields' empty check, and overwrote the stored note for every student in the file.
// Now: blank leaves the note alone on an update, a filled cell overwrites, and only a NEW student
// with no note gets 'None' (existing insert behaviour).
const PG_PORT = 5497;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-39';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('39-import-student-notes');
const { eq } = rec;
const BASE = 'http://localhost:5997';
const PW = 'Secret123!';

async function main() {
  const epg = await startEmbeddedPostgres('39-import-student-notes', PG_PORT);
  try {
    runMigrateUp();
    const q = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await q("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const S = await q("INSERT INTO schools(name,claim_status,claimed_at) VALUES('Elm School','claimed',now()) RETURNING id");
    await q("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('admin@a.test',$1,'Admin','company_admin',$2,now())", [await hashPassword(PW), A.id]);
    const student = (name, notes) => q(
      `INSERT INTO students(company_id,school_id,full_name,grade,age,parent_name,parent_phone,street_address,city,state,zip_code,notes)
       VALUES($1,$2,$3,'3',8,'Pat','555-0100','1 Elm St','Springfield','IL','62701',$4) RETURNING id`,
      [A.id, S.id, name, notes]
    );
    const ana = await student('Ana Lee', 'Wheelchair: needs the lift van. Epipen in backpack.');
    const ben = await student('Ben Ray', 'Seizure plan on file; call parent first.');
    const cal = await student('Cal Fox', 'Needs help buckling.');
    const notesOf = async (id) => (await q('SELECT notes, grade FROM students WHERE id = $1', [id]));

    const server = createApp().listen(5997);
    const post = (p, token, body) => fetch(BASE + p, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
    try {
      const token = (await post('/auth/login', null, { email: 'admin@a.test', password: PW })).body.token;
      const base = (full_name, extra = {}) => ({
        full_name, school: 'Elm School', grade: '4', age: '9', parent_name: 'Pat', parent_phone: '555-0100',
        street_address: '1 Elm St', city: 'Springfield', state: 'IL', zip_code: '62701', ...extra,
      });
      const commit = async (rows) => {
        const r = await post('/imports/commit', token, { type: 'students', rows });
        eq(`  (commit -> 200, errors 0)`, `${r.status} ${r.body.counts?.error}`, '200 0');
        return r.body;
      };

      console.log('--- a file with NO Notes column (roster re-import) ---');
      await commit([base('Ana Lee'), base('Ben Ray')]);
      eq('Ana keeps her note', (await notesOf(ana.id)).notes, 'Wheelchair: needs the lift van. Epipen in backpack.');
      eq('Ben keeps his note', (await notesOf(ben.id)).notes, 'Seizure plan on file; call parent first.');
      eq('the rest of the row still updated (grade 3 -> 4)', (await notesOf(ana.id)).grade, '4');

      console.log('\n--- a Notes column that is present but blank ---');
      await commit([base('Cal Fox', { notes: '' }), base('Ana Lee', { notes: '   ' })]);
      eq('blank cell: Cal keeps his note', (await notesOf(cal.id)).notes, 'Needs help buckling.');
      eq('whitespace-only cell counts as blank: Ana keeps hers', (await notesOf(ana.id)).notes, 'Wheelchair: needs the lift van. Epipen in backpack.');

      console.log('\n--- a filled Notes cell still overwrites ---');
      await commit([base('Ben Ray', { notes: 'Seizure plan updated 2026-10.' })]);
      eq('Ben gets the new note', (await notesOf(ben.id)).notes, 'Seizure plan updated 2026-10.');

      console.log('\n--- a NEW student with no note still gets "None" ---');
      const created = await commit([base('Dee New'), base('Eve New', { notes: '' }), base('Fay New', { notes: 'Peanut allergy' })]);
      eq('three created', created.counts.created, 3);
      const n = async (name) => (await q('SELECT notes FROM students WHERE full_name = $1', [name])).notes;
      eq('no Notes column -> "None"', await n('Dee New'), 'None');
      eq('blank Notes cell -> "None"', await n('Eve New'), 'None');
      eq('filled Notes cell -> kept', await n('Fay New'), 'Peanut allergy');
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
