// Bulk import + account lifecycle (docs/bulk-import-spec.md): preview writes nothing, commit imports
// the good rows and reports the bad ones, temporary passwords come back once and only as hashes in
// the DB, tenants never cross, plus expiry, last login, bounce, reset log and deactivation rules.
const PG_PORT = 5474;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-24';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_FORCE = '1';
process.env.RATE_LIMIT_LOGIN_MAX = '1000';
process.env.RATE_LIMIT_RESET_MAX = '1000';
process.env.RATE_LIMIT_RESET_EMAIL_MAX = '2';
process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from('bounce-test-key-24').toString('base64')}`;

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('24-bulk-import');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5981';
const PW = 'Secret123!';

async function api(method, p, token, body, headers = {}) {
  const opts = { method, headers: { ...headers } };
  if (token) opts.headers.authorization = `Bearer ${token}`;
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(BASE + p, opts);
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: data, headers: r.headers };
}
const login = (email, password = PW) => api('POST', '/auth/login', null, { email, password });
const count = async (sql, params) => (await pool.query(sql, params)).rows[0].n;

async function main() {
  const epg = await startEmbeddedPostgres('24-bulk-import', PG_PORT);
  try {
    runMigrateUp();
    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const B = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    await ins("INSERT INTO students(company_id,school_id,full_name,street_address) VALUES($1,$2,'Seed Kid','1 Seed St') RETURNING id", [A.id, S.id]);
    const user = (email, role, company, school = null) => ins(
      'INSERT INTO users(email,password_hash,full_name,role,company_id,school_id,email_verified_at) VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING id',
      [email, hash, email.split('@')[0], role, company, school]
    );
    await user('admin@a.test', 'company_admin', A.id);
    await user('admin@b.test', 'company_admin', B.id);
    await user('sadmin@s.test', 'school_admin', null, S.id);
    await user('busy@a.test', 'driver', A.id);
    await user('other@b.test', 'driver', B.id);
    // Accounts as they look right after migration 025: no last_login_at, no temp expiry date.
    await user('legacy@a.test', 'driver', A.id);
    await user('legacytemp@a.test', 'driver', A.id);
    await pool.query("UPDATE users SET must_change_password = true WHERE email = 'legacytemp@a.test'");
    const busy = (await pool.query("SELECT id FROM users WHERE email='busy@a.test'")).rows[0];
    const stu = (await pool.query("SELECT id FROM students WHERE full_name='Seed Kid'")).rows[0];
    const van = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year,number,color) VALUES($1,'OLD-1','Ford','Transit',2020,'01','White') RETURNING id", [A.id]);
    await ins("INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,days_of_week) VALUES($1,$2,$3,$4,'2020-01-01','{1,2,3,4,5}') RETURNING id", [A.id, stu.id, busy.id, van.id]);

    const app = createApp();
    const server = app.listen(5981);
    try {
      const tA = (await login('admin@a.test')).body.token;
      const tB = (await login('admin@b.test')).body.token;
      const tS = (await login('sadmin@s.test')).body.token;
      const tDriver = (await login('busy@a.test')).body.token;

      console.log('--- who can import what ---');
      eq('driver cannot open imports -> 403', (await api('GET', '/imports/types', tDriver)).status, 403);
      eq('company admin types', (await api('GET', '/imports/types', tA)).body.types.map((t) => t.id).join(), 'drivers,monitors,parents,vans,students');
      eq('school admin types', (await api('GET', '/imports/types', tS)).body.types.map((t) => t.id).join(), 'staff');
      eq('school admin importing drivers -> 403', (await api('POST', '/imports/preview', tS, { type: 'drivers', rows: [{ full_name: 'X', email: 'x@s.test' }] })).status, 403);
      eq('school admin importing vans -> 403', (await api('POST', '/imports/preview', tS, { type: 'vans', rows: [{ license_plate: 'X' }] })).status, 403);
      eq('company admin importing staff -> 403', (await api('POST', '/imports/preview', tA, { type: 'staff', rows: [{ full_name: 'X', email: 'x@a.test' }] })).status, 403);
      eq('unknown type -> 400', (await api('POST', '/imports/preview', tA, { type: 'cats', rows: [{}] })).status, 400);

      console.log('\n--- limits ---');
      eq('empty file -> 400', (await api('POST', '/imports/preview', tA, { type: 'drivers', rows: [] })).status, 400);
      const big = await api('POST', '/imports/preview', tA, { type: 'drivers', rows: Array.from({ length: 101 }, (_, i) => ({ full_name: `D${i}`, email: `d${i}@a.test` })) });
      (big.status === 400 && /limit is 100/.test(big.body.error) && /Split/.test(big.body.error)) ? ok('101 rows -> clear split-the-file message') : bad(`big: ${JSON.stringify(big.body)}`);

      console.log('\n--- preview writes nothing ---');
      const rows = [
        { full_name: 'New Driver', email: 'new@a.test', phone: '555' },
        { full_name: 'Busy Updated', email: 'BUSY@a.test' },
        { full_name: 'No Email' },
        { full_name: 'Dup One', email: 'dup@a.test' },
        { full_name: 'Dup Two', email: 'Dup@a.test' },
        { full_name: 'Bad Mail', email: 'nope' },
        { full_name: 'Stolen', email: 'other@b.test' },
      ];
      const pv = await api('POST', '/imports/preview', tA, { type: 'drivers', rows });
      // overwrite (prod-safety-and-import-fix): the update row replaces Busy's stored name.
      eq('preview counts', JSON.stringify(pv.body.counts), '{"create":1,"update":1,"error":5,"overwrite":1}');
      eq('row actions', pv.body.rows.map((r) => r.action).join(), 'create,update,error,error,error,error,error');
      ok(/Duplicate email/.test(pv.body.rows[3].reason) && /Duplicate email/.test(pv.body.rows[4].reason) ? 'both duplicate-email rows are errors' : bad('dup reasons'));
      ok(/another account/.test(pv.body.rows[6].reason) ? 'another company\'s email is refused without leaking who it is' : bad(`cross-tenant: ${pv.body.rows[6].reason}`));
      eq('nothing written by preview', await count("SELECT count(*)::int AS n FROM users WHERE email IN ('new@a.test','dup@a.test')"), 0);

      console.log('\n--- commit drivers ---');
      const cm = await api('POST', '/imports/commit', tA, { type: 'drivers', rows });
      eq('commit status', cm.status, 200);
      eq('commit counts', JSON.stringify(cm.body.counts), '{"created":1,"updated":1,"error":5}');
      eq('no-store on the response with passwords', cm.headers.get('cache-control'), 'no-store');
      eq('one credential row', cm.body.credentials.length, 1);
      const cred = cm.body.credentials[0];
      eq('credential shape', `${cred.full_name}|${cred.email}`, 'New Driver|new@a.test');
      const stored = (await pool.query("SELECT password_hash, must_change_password, temp_password_expires_at, company_id FROM users WHERE email='new@a.test'")).rows[0];
      ok(stored.password_hash !== cred.temporary_password && stored.password_hash.startsWith('$2') ? 'only a hash is stored' : bad('plain password stored'));
      eq('must change password', stored.must_change_password, true);
      eq('belongs to the importer\'s company', stored.company_id, A.id);
      const days = (new Date(stored.temp_password_expires_at) - Date.now()) / 86400000;
      ok(days > 6.9 && days < 7.1 ? 'temp password expires in 7 days' : bad(`expiry ${days}`));
      eq('update changed the name', (await pool.query("SELECT full_name FROM users WHERE email='busy@a.test'")).rows[0].full_name, 'Busy Updated');
      eq('no duplicates created', await count("SELECT count(*)::int AS n FROM users WHERE lower(email)='busy@a.test'"), 1);
      eq('the other company\'s driver is untouched', (await pool.query("SELECT full_name FROM users WHERE email='other@b.test'")).rows[0].full_name, 'other');
      const again = await api('POST', '/imports/commit', tA, { type: 'drivers', rows: [rows[0]] });
      eq('importing the same row again updates, never duplicates', JSON.stringify(again.body.counts), '{"created":0,"updated":1,"error":0}');
      eq('and returns no new password', again.body.credentials.length, 0);

      console.log('\n--- first login, status, expiry ---');
      const first = await login('new@a.test', cred.temporary_password);
      eq('imported driver logs in with the temp password', first.status, 200);
      eq('flagged must_change_password', first.body.user.must_change_password, true);
      eq('other routes are blocked until it is changed', (await api('GET', '/schedule/today', first.body.token)).status, 403);
      const users = (await api('GET', '/users', tA)).body;
      eq('account status after first login: created (password not yet changed)', users.find((u) => u.email === 'new@a.test').account_status, 'created');
      const legacy = users.find((u) => u.email === 'legacy@a.test');
      eq('pre-migration account that set its password (never logged in since): active', legacy.account_status, 'active');
      eq('pre-migration account on a temporary password with no expiry date: created', users.find((u) => u.email === 'legacytemp@a.test').account_status, 'created');
      eq('and that old temporary password still logs in (it has no expiry)', (await login('legacytemp@a.test')).status, 200);
      await pool.query("UPDATE users SET temp_password_expires_at = now() - interval '1 minute' WHERE email='new@a.test'");
      eq('an expired, unused temporary password: never_logged_in', (await api('GET', '/users', tA)).body.find((u) => u.email === 'new@a.test').account_status, 'never_logged_in');
      const exp = await login('new@a.test', cred.temporary_password);
      eq('expired temp password -> 401', exp.status, 401);
      eq('with a clear code', exp.body.code, 'TEMP_PASSWORD_EXPIRED');
      eq('an existing token stops working once it is expired', (await api('GET', '/auth/me', first.body.token)).status, 401);
      eq('wrong password still looks like a wrong password', (await login('new@a.test', 'Wrong123!x')).body.code, undefined);
      const rs = await api('POST', '/users/' + users.find((u) => u.email === 'new@a.test').id + '/reset-password', tA);
      eq('admin reset gives a fresh temporary password', (await login('new@a.test', rs.body.temporary_password)).status, 200);
      eq('the reset is logged (who, for whom)', await count("SELECT count(*)::int AS n FROM password_reset_log WHERE method='admin_reset' AND actor_user_id IS NOT NULL"), 1);

      console.log('\n--- monitors, parents, vans ---');
      const mon = await api('POST', '/imports/commit', tA, { type: 'monitors', rows: [{ full_name: 'Mo', email: 'mo@a.test' }] });
      eq('monitor imported', mon.body.counts.created, 1);
      eq('role is monitor', (await pool.query("SELECT role FROM users WHERE email='mo@a.test'")).rows[0].role, 'monitor');
      const par = await api('POST', '/imports/commit', tA, { type: 'parents', rows: [{ full_name: 'Pat', email: 'pat@a.test' }, { full_name: 'Pam', email: 'pam@a.test', phone: '555', address: '1 Main' }] });
      eq('parent without phone/address -> error, with phone/address -> created', `${par.body.rows[0].status} ${par.body.rows[1].status}`, 'error created');
      ok(/Phone, Address/.test(par.body.rows[0].reason) ? 'error names the missing fields' : bad(par.body.rows[0].reason));
      const asDriver = await api('POST', '/imports/commit', tA, { type: 'drivers', rows: [{ full_name: 'Pam', email: 'pam@a.test' }] });
      ok(/parent/.test(asDriver.body.rows[0].reason) ? 'a parent email cannot be imported as a driver' : bad(asDriver.body.rows[0].reason));
      const vans = await api('POST', '/imports/commit', tA, { type: 'vans', rows: [
        { license_plate: 'NEW-1', brand: 'Ford', model: 'T', year: '2021', color: 'Blue', number: '02' },
        { license_plate: 'old-1', brand: 'Ram', model: 'P', year: '2020', color: 'Red' },
        { license_plate: 'BAD-1', brand: 'Ford', model: 'T', year: '20', color: 'Blue' },
        { license_plate: 'NEW-3', brand: 'Ford', model: 'T', year: '2021', color: 'Blue', number: '01' },
      ] });
      eq('van results', vans.body.rows.map((r) => r.status).join(), 'created,updated,error,error');
      eq('plate match is case-insensitive and updates', (await pool.query("SELECT brand FROM vans WHERE id=$1", [van.id])).rows[0].brand, 'Ram');
      eq('van in another company untouched by mismatched plate', await count("SELECT count(*)::int AS n FROM vans WHERE company_id=$1", [B.id]), 0);

      console.log('\n--- students ---');
      const stRow = (o = {}) => ({ full_name: 'Ann Lee', school: 'School S', grade: '3', age: '8', parent_name: 'Pia Lee', parent_phone: '555-1', parent_email: 'pia@a.test', street_address: '9 Oak', city: 'Chicago', state: 'IL', zip_code: '60601', notes: '', ...o });
      const stRows = [stRow(), stRow({ full_name: 'Bo Lee', parent_email: 'pia@a.test' }), stRow({ full_name: 'Cy', school: 'Nowhere' }), stRow({ full_name: 'Di', state: 'ZZ' }), stRow({ full_name: 'Ed', age: '99' })];
      const sp = await api('POST', '/imports/preview', tA, { type: 'students', rows: stRows });
      eq('student preview', sp.body.rows.map((r) => r.action).join(), 'create,create,error,error,error');
      ok(/School "Nowhere" was not found/.test(sp.body.rows[2].reason) ? 'unknown school is a clear row error' : bad(sp.body.rows[2].reason));
      const sc = await api('POST', '/imports/commit', tA, { type: 'students', rows: stRows });
      eq('students created', sc.body.counts.created, 2);
      eq('the parent is created from the row, once', sc.body.credentials.filter((c) => c.email === 'pia@a.test').length, 1);
      eq('both students are linked to that parent', await count("SELECT count(*)::int AS n FROM parent_students ps JOIN users u ON u.id=ps.parent_user_id WHERE u.email='pia@a.test'"), 2);
      eq('students have no driver or van', await count("SELECT count(*)::int AS n FROM assignments a JOIN students s ON s.id=a.student_id WHERE s.full_name IN ('Ann Lee','Bo Lee')"), 0);
      const su = await api('POST', '/imports/commit', tA, { type: 'students', rows: [stRow({ grade: '4' })] });
      eq('same student again updates', JSON.stringify(su.body.counts), '{"created":0,"updated":1,"error":0}');
      eq('and the update landed', (await pool.query("SELECT grade FROM students WHERE full_name='Ann Lee'")).rows[0].grade, '4');
      eq('company B cannot see School S, so no student import there', (await api('POST', '/imports/preview', tB, { type: 'students', rows: [stRow()] })).body.rows[0].action, 'error');

      console.log('\n--- school staff ---');
      const st = await api('POST', '/imports/commit', tS, { type: 'staff', rows: [{ full_name: 'Sue', email: 'sue@s.test' }, { full_name: 'Bad', email: 'busy@a.test' }] });
      eq('staff import', `${st.body.rows[0].status} ${st.body.rows[1].status}`, 'created error');
      eq('staff belong to the school, not a company', JSON.stringify((await pool.query("SELECT role, school_id IS NOT NULL AS s, company_id IS NULL AS c FROM users WHERE email='sue@s.test'")).rows[0]), '{"role":"school_staff","s":true,"c":true}');

      console.log('\n--- remembered mapping ---');
      eq('none saved yet', (await api('GET', '/imports/mapping?type=drivers', tA)).body.mapping, null);
      await api('PUT', '/imports/mapping', tA, { type: 'drivers', mapping: { full_name: 'Name', email: 'E-mail', hacker: 'x' } });
      const saved = (await api('GET', '/imports/mapping?type=drivers', tA)).body.mapping;
      eq('saved per company, unknown fields dropped', `${Object.keys(saved).sort()} ${saved.full_name} ${saved.email}`, 'email,full_name Name E-mail');
      const dupNum = await api('POST', '/imports/preview', tA, { type: 'vans', rows: [{ license_plate: 'X-1', brand: 'a', model: 'b', year: '2020', color: 'c', number: '09' }, { license_plate: 'X-2', brand: 'a', model: 'b', year: '2020', color: 'c', number: '09' }] });
      eq('duplicate van number in a file errors both rows', dupNum.body.rows.map((r) => r.action).join(), 'error,error');
      eq('another company does not see it', (await api('GET', '/imports/mapping?type=drivers', tB)).body.mapping, null);

      console.log('\n--- deactivation ---');
      const busyId = busy.id;
      const blocked = await api('PATCH', `/users/${busyId}`, tA, { is_active: false });
      eq('driver with active assignments -> 409', blocked.status, 409);
      eq('with the spec message', blocked.body.error, 'This driver has 1 active assignment. Reassign it before deactivating.');
      await pool.query('DELETE FROM assignments WHERE driver_user_id=$1', [busyId]);
      eq('after reassigning, deactivate works', (await api('PATCH', `/users/${busyId}`, tA, { is_active: false })).status, 200);
      eq('deactivated user cannot log in', (await login('busy@a.test')).status, 401);
      const gone = await api('GET', '/auth/me', tDriver);
      eq("the deactivated user's open session ends with code ACCOUNT_INACTIVE", `${gone.status} ${gone.body?.code}`, '401 ACCOUNT_INACTIVE');
      eq('but the row is kept', await count("SELECT count(*)::int AS n FROM users WHERE id=$1 AND NOT is_active", [busyId]), 1);
      eq('an import cannot reactivate or edit them', (await api('POST', '/imports/preview', tA, { type: 'drivers', rows: [{ full_name: 'x', email: 'busy@a.test' }] })).body.rows[0].action, 'error');
      const mo = (await pool.query("SELECT id FROM users WHERE email='mo@a.test'")).rows[0];
      await pool.query("INSERT INTO monitor_assignments(company_id,monitor_user_id,driver_user_id) VALUES($1,$2,$3)", [A.id, mo.id, (await pool.query("SELECT id FROM users WHERE email='new@a.test'")).rows[0].id]);
      eq('monitor with an assignment cannot be deactivated', (await api('PATCH', `/users/${mo.id}`, tA, { is_active: false })).status, 409);

      console.log('\n--- email bounce ---');
      const bounceBody = { type: 'email.bounced', data: { to: ['pia@a.test'] } };
      eq('unsigned bounce webhook -> 401', (await api('POST', '/webhooks/email-bounce', null, bounceBody)).status, 401);
      // Svix signature, as Resend sends it (see 28-resend-webhook.test.cjs).
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = require('crypto').createHmac('sha256', Buffer.from('bounce-test-key-24')).update(`msg_24.${ts}.${JSON.stringify(bounceBody)}`).digest('base64');
      const bounce = await api('POST', '/webhooks/email-bounce', null, bounceBody, { 'svix-id': 'msg_24', 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` });
      eq('signed bounce webhook -> 2xx', bounce.status < 300, true);
      const flagged = (await api('GET', '/users', tA)).body.find((u) => u.email === 'pia@a.test');
      eq('the account shows email_bounced', flagged.email_bounced, true);
      const mailer = require('../src/mail/mailer.js');
      mailer._reset();
      await api('POST', '/auth/forgot-password', null, { email: 'pia@a.test' });
      eq('no mail is sent to a bounced address', (await mailer._drained()).length, 0);
      await api('PATCH', `/users/${flagged.id}`, tA, { email: 'pia2@a.test' });
      eq('correcting the email clears the flag', (await api('GET', '/users', tA)).body.find((u) => u.id === flagged.id).email_bounced, false);

      console.log('\n--- reset rate limit + no account leak ---');
      mailer._reset();
      const r1 = await api('POST', '/auth/forgot-password', null, { email: 'ghost@nowhere.test' });
      const r2 = await api('POST', '/auth/forgot-password', null, { email: 'ghost@nowhere.test' });
      const r3 = await api('POST', '/auth/forgot-password', null, { email: 'ghost@nowhere.test' });
      eq('unknown email answers like a known one', `${r1.status} ${r2.status}`, '200 200');
      eq('third request for one email within the hour -> 429', r3.status, 429);
      const self = await api('POST', '/auth/forgot-password', null, { email: 'sue@s.test' });
      eq('a different email is unaffected', self.status, 200);
      await mailer._drained();
      const raw = /token=([0-9a-f]+)/.exec(mailer._sent().at(-1).text)[1];
      eq('self-service reset completes', (await api('POST', '/auth/reset-password', null, { token: raw, newPassword: 'BrandNew9!x' })).status, 200);
      eq('self-service reset is logged', await count("SELECT count(*)::int AS n FROM password_reset_log WHERE method='self_service'"), 1);
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
