// Possible duplicate students: students.duplicate_name is set on both students when a second
// student of the same company at the same school gets the same name (on create or rename), and
// cleared when that stops being true. Never blocks a write; never looks at other companies.
const PG_PORT = 5477;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-27';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('27-duplicate-student-flag');
const { eq } = rec;
const BASE = 'http://localhost:5984';
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
const flag = async (id) => (await pool.query('SELECT duplicate_name FROM students WHERE id = $1', [id])).rows[0]?.duplicate_name;

async function main() {
  const epg = await startEmbeddedPostgres('27-duplicate-student-flag', PG_PORT);
  try {
    runMigrateUp();
    const hash = await hashPassword(PW);
    const one = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id")).id;
    const B = (await one("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id")).id;
    const S1 = (await one("INSERT INTO schools(name,claim_status,claimed_at) VALUES('Lincoln','claimed',now()) RETURNING id")).id;
    const S2 = (await one("INSERT INTO schools(name,claim_status,claimed_at) VALUES('Grant','claimed',now()) RETURNING id")).id;
    for (const [email, role, c, s] of [['admin@a.test', 'company_admin', A, null], ['admin@b.test', 'company_admin', B, null], ['sadmin@s1.test', 'school_admin', null, S1]]) {
      await pool.query('INSERT INTO users(email,password_hash,full_name,role,company_id,school_id,email_verified_at) VALUES($1,$2,$3,$4,$5,$6,now())', [email, hash, email, role, c, s]);
    }
    await pool.query("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,'B Seed'),($1,$3,'B Seed')", [B, S1, S2]);

    const app = createApp();
    const server = app.listen(5984);
    try {
      const tA = await login('admin@a.test');
      const tB = await login('admin@b.test');
      const tS = await login('sadmin@s1.test');
      const body = (o) => ({ full_name: 'Ann Lee', grade: '3', age: 8, parent_name: 'P', parent_phone: '555', school_id: S1, street_address: '1 Oak', city: 'Chicago', state: 'IL', zip_code: '60601', notes: 'None', ...o });

      console.log('--- create ---');
      const first = await api('POST', '/students', tA, body());
      eq('a single student is not flagged', first.body?.duplicate_name, false);
      const second = await api('POST', '/students', tA, body({ full_name: '  ann   LEE ' }));
      eq('creating a same-name student is not blocked (201)', second.status, 201);
      eq('the new student is flagged (and the create response says so)', `${await flag(second.body.id)} ${second.body.duplicate_name}`, 'true true');
      eq('and so is the first one', await flag(first.body.id), true);
      eq('the API returns the flag', (await api('GET', `/students/${first.body.id}`, tA)).body?.duplicate_name, true);
      const otherSchool = await api('POST', '/students', tA, body({ school_id: S2 }));
      eq('same name at another school is not a duplicate', await flag(otherSchool.body.id), false);
      const bAnn = await api('POST', '/students', tB, body());
      eq("another company's same-name student at the same school is not flagged", await flag(bAnn.body.id), false);
      eq("and doesn't change company A's flags", `${await flag(first.body.id)} ${await flag(second.body.id)}`, 'true true');

      console.log('\n--- rename and delete ---');
      const away = await api('PATCH', `/students/${second.body.id}`, tA, { full_name: 'Ann Leigh' });
      eq('renaming away clears both (and the response says so)', `${await flag(first.body.id)} ${await flag(second.body.id)} ${away.body.duplicate_name}`, 'false false false');
      await api('PATCH', `/students/${second.body.id}`, tA, { full_name: 'Ann Lee' });
      eq('renaming back flags both again', `${await flag(first.body.id)} ${await flag(second.body.id)}`, 'true true');
      await api('DELETE', `/students/${second.body.id}`, tA);
      eq('deleting one clears the other', await flag(first.body.id), false);
      const third = await one("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,'ANN LEE') RETURNING id", [A, S1]);
      eq('any write path flags (raw insert)', `${await flag(first.body.id)} ${await flag(third.id)}`, 'true true');

      console.log('\n--- shown to admins ---');
      eq('company list carries the flag', (await api('GET', '/students', tA)).body.find((s) => s.id === first.body.id)?.duplicate_name, true);
      eq('school admin list carries the flag', (await api('GET', '/students', tS)).body.find((s) => s.id === first.body.id)?.duplicate_name, true);

      console.log('\n--- import result ---');
      const row = (o) => ({ full_name: 'Bo Ray', school: 'Lincoln', grade: '2', age: '7', parent_name: 'P', parent_phone: '555', street_address: '1 Oak', city: 'Chicago', state: 'IL', zip_code: '60601', ...o });
      const plain = await api('POST', '/imports/commit', tA, { type: 'students', rows: [row()] });
      eq('an import with no duplicates reports none', `${plain.body.counts.created} ${plain.body.duplicates.length}`, '1 0');
      // "Bo  Ray" (two spaces) is not the import's name match for "Bo Ray", so it is created, and the
      // duplicate flag (which ignores repeated spaces) catches it.
      const dup = await api('POST', '/imports/commit', tA, { type: 'students', rows: [row({ full_name: 'Bo  Ray' }), row({ full_name: 'Cy Doe' })] });
      eq('the import still creates the row', dup.body.counts.created, 2);
      eq('and lists it as a possible duplicate', JSON.stringify(dup.body.duplicates), JSON.stringify([{ index: 0, full_name: 'Bo  Ray', status: 'created' }]));
      eq('both Bo Rays are flagged', (await pool.query("SELECT count(*)::int AS n FROM students WHERE company_id=$1 AND duplicate_name AND lower(full_name) LIKE 'bo%ray'", [A])).rows[0].n, 2);
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
