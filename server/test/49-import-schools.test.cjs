// The Schools import type (bulk-import spec section 6: schools before students). A company imports
// schools as unclaimed placeholders it created; it may update them only while they are unclaimed
// and were added by one of its own users. The update re-checks that in its WHERE clause, so a
// school claimed between preview and commit is refused, not overwritten.
const PG_PORT = 5530;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-49';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const { execSchool } = require('../src/services/bulkImport.js');

const rec = createRecorder('49-import-schools');
const { eq } = rec;
const PORT = 6049;
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

async function main() {
  const epg = await startEmbeddedPostgres('49-import-schools', PG_PORT);
  try {
    runMigrateUp();
    const hash = await hashPassword(PW);
    const one = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id")).id;
    const B = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id")).id;
    const S = (await one("INSERT INTO schools(name,claim_status,claimed_at) VALUES('Own School','claimed',now()) RETURNING id")).id;
    const user = (email, role, company, school = null) => one(
      'INSERT INTO users(email,password_hash,full_name,role,company_id,school_id,email_verified_at) VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING id',
      [email, hash, email.split('@')[0], role, company, school]
    ).then((r) => r.id);
    const adminA = await user('admin@a.test', 'company_admin', A);
    const adminA2 = await user('admin2@a.test', 'company_admin', A);
    await user('admin@b.test', 'company_admin', B);
    await user('sadmin@s.test', 'school_admin', null, S);
    const schoolRow = (name) => one('SELECT * FROM schools WHERE name = $1', [name]);
    const countNamed = async (name) => (await one('SELECT count(*)::int AS n FROM schools WHERE lower(name) = lower($1)', [name])).n;

    const app = createApp();
    const server = app.listen(PORT);
    try {
      const tA = await login('admin@a.test');
      const tA2 = await login('admin2@a.test');
      const tB = await login('admin@b.test');
      const tS = await login('sadmin@s.test');

      console.log('--- the type is offered to company admins only, first in the list ---');
      const typesA = (await api('GET', '/imports/types', tA)).body.types.map((t) => t.id);
      eq('company_admin: schools is the first type', typesA[0], 'schools');
      const typesS = (await api('GET', '/imports/types', tS)).body.types.map((t) => t.id);
      eq('school_admin: schools is not offered', typesS.includes('schools'), false);
      const s1 = { name: 'Lakeside Prep', address: '1 Lake Rd, Chicago', state: 'il', zip_code: '60601', phone: '555-0100', hours: '8-3', website: 'lakeside.test' };
      eq('school_admin: preview type=schools -> 403', (await api('POST', '/imports/preview', tS, { type: 'schools', rows: [s1] })).status, 403);
      eq('school_admin: commit type=schools -> 403', (await api('POST', '/imports/commit', tS, { type: 'schools', rows: [s1] })).status, 403);
      eq('school_admin: mapping type=schools -> 403', (await api('GET', '/imports/mapping?type=schools', tS)).status, 403);
      eq('school_admin import created no school', await countNamed('Lakeside Prep'), 0);

      console.log('\n--- end to end: a students file that fails without its school ---');
      const kid = { full_name: 'Ava Kim', school: 'Lakeside Prep', grade: '3', age: '8', parent_name: 'Jo Kim', parent_phone: '555-0101', street_address: '9 Elm St', city: 'Chicago', state: 'IL', zip_code: '60601' };
      const before = await api('POST', '/imports/preview', tA, { type: 'students', rows: [kid] });
      eq('students preview before: row error', actions(before), 'error');
      eq('the error points at the Schools import', before.body.rows[0].reason, 'School "Lakeside Prep" was not found. Import your schools first (Import, then Schools), then import the students.');

      console.log('\n--- create: unclaimed placeholders created by the importer ---');
      const s2 = { name: 'Hill Elementary', address: '2 Hill Ave, Evanston' };
      const pv = await api('POST', '/imports/preview', tA, { type: 'schools', rows: [s1, s2] });
      eq('preview: both create', actions(pv), 'create,create');
      eq('preview wrote nothing', await countNamed('Lakeside Prep'), 0);
      const cm = await api('POST', '/imports/commit', tA, { type: 'schools', rows: [s1, s2] });
      eq('commit: 2 created', JSON.stringify(cm.body.counts), '{"created":2,"updated":0,"error":0}');
      eq('commit: no credentials (schools create no accounts)', cm.body.credentials.length, 0);
      const lake = await schoolRow('Lakeside Prep');
      eq('claim_status is unclaimed', lake.claim_status, 'unclaimed');
      eq('created_by_user_id is the importing admin', lake.created_by_user_id, adminA);
      eq('state is stored uppercased', lake.state, 'IL');
      eq('all optional fields stored', [lake.zip_code, lake.phone, lake.hours, lake.website].join('|'), '60601|555-0100|8-3|lakeside.test');
      const hill = await schoolRow('Hill Elementary');
      eq('empty optional fields stored as NULL', [hill.state, hill.zip_code, hill.phone].join('|'), '||');

      const after = await api('POST', '/imports/preview', tA, { type: 'students', rows: [kid] });
      eq('students preview after: will create', actions(after), 'create');

      console.log('\n--- re-import updates, does not duplicate ---');
      const again = await api('POST', '/imports/preview', tA, { type: 'schools', rows: [{ ...s1, phone: '555-0199' }, { ...s2, name: 'hill elementary' }] });
      eq('re-import preview: both update (name match ignores case)', actions(again), 'update,update');
      eq('the preview lists the phone change', JSON.stringify(again.body.rows[0].changes.map((c) => [c.field, c.old, c.new])), '[["phone","555-0100","555-0199"]]');
      const re = await api('POST', '/imports/commit', tA, { type: 'schools', rows: [{ ...s1, phone: '555-0199' }, s2] });
      eq('re-import commit: 2 updated', JSON.stringify(re.body.counts), '{"created":0,"updated":2,"error":0}');
      eq('still one Lakeside Prep', await countNamed('Lakeside Prep'), 1);
      eq('phone updated', (await schoolRow('Lakeside Prep')).phone, '555-0199');
      eq('blank cells left the stored values alone', (await schoolRow('Lakeside Prep')).website, 'lakeside.test');
      const byA2 = await api('POST', '/imports/commit', tA2, { type: 'schools', rows: [{ ...s2, hours: '7-2' }] });
      eq('another admin of the same company can update it too', JSON.stringify(byA2.body.counts), '{"created":0,"updated":1,"error":0}');

      console.log('\n--- a claimed school is a row error and is not changed ---');
      const claimed = (await one("INSERT INTO schools(name,address,claim_status,claimed_at,created_by_user_id) VALUES('Claimed Academy','5 Real St','claimed',now(),$1) RETURNING id", [adminA])).id;
      const cl = await api('POST', '/imports/commit', tA, { type: 'schools', rows: [{ name: 'Claimed Academy', address: '99 Fake St' }] });
      eq('commit: 1 error', JSON.stringify(cl.body.counts), '{"created":0,"updated":0,"error":1}');
      eq('reason says it has its own account', cl.body.rows[0].reason, 'Claimed Academy has its own SafeTurns account, so only they can change its details.');
      eq('claimed school address unchanged', (await one('SELECT address FROM schools WHERE id=$1', [claimed])).address, '5 Real St');
      eq('and no second Claimed Academy was created', await countNamed('Claimed Academy'), 1);

      console.log('\n--- duplicate names in one file ---');
      const dup = await api('POST', '/imports/preview', tA, { type: 'schools', rows: [{ name: 'Twin School', address: 'a' }, { name: 'twin school', address: 'b' }, { name: 'Solo School', address: 'c' }] });
      eq('both duplicate rows are errors, the other row is fine', actions(dup), 'error,error,create');
      eq('duplicate reason', /^Duplicate school name/.test(dup.body.rows[0].reason), true);

      console.log('\n--- state and zip ---');
      const sz = await api('POST', '/imports/preview', tA, { type: 'schools', rows: [
        { name: 'Bad State', address: 'x', state: 'ZZ' },
        { name: 'Bad Zip', address: 'x', zip_code: '123' },
        { name: 'Empty Both', address: 'x', state: '', zip_code: '' },
        { name: 'No Address' },
      ] });
      eq('bad state, bad zip, missing address are errors; empty state/zip is fine', actions(sz), 'error,error,create,error');
      eq('bad state reason', sz.body.rows[0].reason, 'State must be a 2-letter US state code, like IL');
      eq('bad zip reason', sz.body.rows[1].reason, 'Zip code must be a valid US zip, like 60601');
      eq('missing reason', sz.body.rows[3].reason, 'Missing: Address');

      console.log('\n--- company B cannot update a school company A created ---');
      // B is linked to A's school (B has a student there), so B sees it by name.
      await pool.query("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,'B Kid')", [B, lake.id]);
      const bp = await api('POST', '/imports/commit', tB, { type: 'schools', rows: [{ name: 'Lakeside Prep', address: 'B was here' }] });
      eq('B commit: row error', JSON.stringify(bp.body.counts), '{"created":0,"updated":0,"error":1}');
      eq('B reason names the other company', bp.body.rows[0].reason, 'Lakeside Prep was added by another company, so only they can change its details.');
      eq("A's school address unchanged", (await schoolRow('Lakeside Prep')).address, '1 Lake Rd, Chicago');
      // The SQL guard on its own, with a forged plan (B claiming A's school id is an update).
      const forged = await execSchool({ auth: { tenantId: B, userId: adminA } }, { action: 'update', existingId: lake.id, row: { name: 'Lakeside Prep', address: 'forged', state: '', zip_code: '', phone: '', hours: '', website: '' } });
      eq('forged update from B is refused by the WHERE guard', /own SafeTurns account/.test(forged ?? ''), true);
      eq("A's school still unchanged", (await schoolRow('Lakeside Prep')).address, '1 Lake Rd, Chicago');

      console.log('\n--- claimed between preview and commit ---');
      await pool.query("UPDATE schools SET claim_status='claimed', claimed_at=now() WHERE name='Hill Elementary'");
      const race = await execSchool({ auth: { tenantId: A, userId: adminA } }, { action: 'update', existingId: hill.id, row: { name: 'Hill Elementary', address: 'too late', state: '', zip_code: '', phone: '', hours: '', website: '' } });
      eq('update of a just-claimed school returns the refusal, does not throw', race, 'Hill Elementary has its own SafeTurns account, so only they can change its details.');
      eq('just-claimed school not changed', (await schoolRow('Hill Elementary')).address, '2 Hill Ave, Evanston');

      console.log('\n--- GET /schools carries what the Schools page shows ---');
      const list = (await api('GET', '/schools', tA)).body;
      const lk = list.find((s) => s.name === 'Lakeside Prep');
      eq('address, claim status and who added it', JSON.stringify([lk.address, lk.claim_status, lk.added_by_company, lk.added_by_you]), '["1 Lake Rd, Chicago","unclaimed",true,true]');
      const lkA2 = (await api('GET', '/schools', tA2)).body.find((s) => s.name === 'Lakeside Prep');
      eq('another admin of the company: added_by_company but not added_by_you', JSON.stringify([lkA2.added_by_company, lkA2.added_by_you]), '[true,false]');
      const lkB = (await api('GET', '/schools', tB)).body.find((s) => s.name === 'Lakeside Prep');
      eq('company B sees it as not added by them', JSON.stringify([lkB.added_by_company, lkB.added_by_you]), '[false,false]');
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
