// Parent role + account-permission changes (2026-08-25 task):
//   - parent is a real, company-scoped role, creatable only by company_admin
//   - company_admin can no longer create company_admin; school_admin can no longer create
//     school_admin (both narrowed to what the task's spec actually enumerated)
//   - only the admin who CREATED an account may edit its password/email/profile info
//     (grandfathered NULL-creator rows stay editable by any same-tenant admin)
//   - parent<->student linking (many-to-many) + the real (not mockup) Skip Today's Pickup
//     notification flow
const PG_PORT = 5459;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-09';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const mailer = require('../src/mail/mailer.js');

const rec = createRecorder('09-parent-and-permissions');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:4900';
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
const login = async (email, password = PW) => (await api('POST', '/auth/login', null, { email, password })).body;

async function main() {
  const epg = await startEmbeddedPostgres('09-parent-and-permissions', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const B = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    await ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('a1@co.com',$1,'Admin A1','company_admin',$2,now()) RETURNING id",
      [hash, A.id]
    );
    await ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('a2@co.com',$1,'Admin A2','company_admin',$2,now()) RETURNING id",
      [hash, A.id]
    );
    await ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('b1@co.com',$1,'Admin B1','company_admin',$2,now()) RETURNING id",
      [hash, B.id]
    );
    await ins(
      "INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('sa@sch.com',$1,'School Admin','school_admin',$2,now()) RETURNING id",
      [hash, S.id]
    );
    // Legacy row simulating an account that pre-dates created_by_user_id (grandfathered).
    const legacyDriver = await ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at,created_by_user_id) VALUES('legacy@co.com',$1,'Legacy Driver','driver',$2,now(),NULL) RETURNING id",
      [hash, A.id]
    );
    const vanA = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'AAA-1','Ford','Transit',2022) RETURNING id", [A.id]);

    const app = createApp();
    const server = app.listen(4900);
    try {
      const a1 = await login('a1@co.com');
      const a2 = await login('a2@co.com');
      const b1 = await login('b1@co.com');
      const sa = await login('sa@sch.com');
      const tA1 = a1.token, tA2 = a2.token, tB1 = b1.token, tSA = sa.token;

      console.log('--- Narrowed CREATABLE (task spec: exactly enumerated roles only) ---');
      eq(
        'company_admin creating company_admin -> 403 (no longer creatable)',
        (await api('POST', '/users', tA1, { role: 'company_admin', email: 'x1@co.com', fullName: 'x', password: PW })).status,
        403
      );
      eq(
        'school_admin creating school_admin -> 403 (no longer creatable)',
        (await api('POST', '/users', tSA, { role: 'school_admin', email: 'x2@sch.com', fullName: 'x', password: PW })).status,
        403
      );
      eq(
        'school_admin creating school_staff -> 201 (still allowed)',
        (await api('POST', '/users', tSA, { role: 'school_staff', email: 'staff@sch.com', fullName: 'Staff One', password: PW })).status,
        201
      );

      console.log('\n--- Parent role creation ---');
      const mkParent = await api('POST', '/users', tA1, { role: 'parent', email: 'parent1@co.com', fullName: 'Parent One', password: PW, phone: '555-0300', address: '3 Willow Ln, Springfield, IL 62701' });
      (mkParent.status === 201 && mkParent.body.role === 'parent' && mkParent.body.email_verified_at)
        ? ok('company_admin creates parent account (email_verified stamped)')
        : bad(`parent create: ${mkParent.status} ${JSON.stringify(mkParent.body)}`);
      const parentId = mkParent.body.id;
      eq('created_by_user_id stamped to creating admin', mkParent.body.created_by_user_id, a1.user.id);
      eq(
        'company_admin creating a school_staff -> 403 (still cross-side gated)',
        (await api('POST', '/users', tA1, { role: 'school_staff', email: 'z@z.com', fullName: 'z', password: PW })).status,
        403
      );

      const mkDriverX = await api('POST', '/users', tA1, { role: 'driver', email: 'driverx@co.com', fullName: 'Driver X', password: PW, phone: '555-0200', address: '2 Oak St', licenseNumber: 'D2000002' });
      const driverXId = mkDriverX.body.id;

      console.log('\n--- Creator-only edit ---');
      eq('creator (a1) PATCHes account they created -> 200', (await api('PATCH', `/users/${driverXId}`, tA1, { phone: '555-0001' })).status, 200);
      eq(
        'a different same-tenant admin (a2, not creator) PATCHing -> 403',
        (await api('PATCH', `/users/${driverXId}`, tA2, { phone: '555-9999' })).status,
        403
      );
      const emailEdit = await api('PATCH', `/users/${driverXId}`, tA1, { email: 'driverx-new@co.com' });
      (emailEdit.status === 200 && emailEdit.body.email === 'driverx-new@co.com')
        ? ok('creator can edit the account they created\'s email')
        : bad(`email edit: ${emailEdit.status} ${JSON.stringify(emailEdit.body)}`);
      const pwEdit = await api('PATCH', `/users/${driverXId}`, tA1, { password: 'NewSecret456!' });
      eq('creator can edit the account they created\'s password -> 200', pwEdit.status, 200);
      const loginOldPw = await login('driverx-new@co.com', PW);
      const loginNewPw = await login('driverx-new@co.com', 'NewSecret456!');
      (!loginOldPw.token && loginNewPw.token)
        ? ok('password change took effect (old rejected, new accepted)')
        : bad('password change did not take effect correctly');

      eq(
        'grandfathered (created_by_user_id NULL) row editable by any same-tenant admin',
        (await api('PATCH', `/users/${legacyDriver.id}`, tA2, { phone: '555-1111' })).status,
        200
      );

      console.log('\n--- Parent <-> Student linking ---');
      // Required fields per the Students page task (2026-08-27) — see server/src/routes/students.js.
      const studentFields = {
        grade: '3', age: 8, parent_name: 'Pat Guardian', parent_phone: '555-1000',
        street_address: '5 Elm St', city: 'Boston', state: 'MA', zip_code: '02139', notes: 'None',
      };
      const stuEligible = (await api('POST', '/students', tA1, { full_name: 'Elig Kid', school_id: S.id, ...studentFields })).body;
      const stuIneligible = (await api('POST', '/students', tA1, { full_name: 'Inelig Kid', school_id: S.id, ...studentFields })).body;
      const stuUnlinked = (await api('POST', '/students', tA1, { full_name: 'Unlinked Kid', school_id: S.id, ...studentFields })).body;

      const link1 = await api('POST', '/parent-access', tA1, { parent_user_id: parentId, student_id: stuEligible.id });
      eq('link parent to eligible student -> 201', link1.status, 201);
      const link2 = await api('POST', '/parent-access', tA1, { parent_user_id: parentId, student_id: stuIneligible.id });
      eq('link parent to ineligible student -> 201', link2.status, 201);

      const listLinks = await api('GET', '/parent-access', tA1);
      eq('list shows 2 links for company A', (listLinks.body ?? []).length, 2);

      eq(
        'cross-company parent-link (B admin using A\'s ids) -> 400 (composite FK)',
        (await api('POST', '/parent-access', tB1, { parent_user_id: parentId, student_id: stuUnlinked.id })).status,
        400
      );

      console.log('\n--- Parent portal ---');
      const parentLogin = await login('parent1@co.com');
      const tParent = parentLogin.token;
      const myStudents = await api('GET', '/parent/students', tParent);
      const myIds = (myStudents.body ?? []).map((s) => s.id).sort();
      (myStudents.status === 200 && myIds.length === 2 && myIds.includes(stuEligible.id) && myIds.includes(stuIneligible.id))
        ? ok('parent sees exactly their linked students')
        : bad(`parent students: ${myStudents.status} ${JSON.stringify(myStudents.body)}`);
      eq(
        'non-parent role hitting /parent/students -> 403',
        (await api('GET', '/parent/students', tA1)).status,
        403
      );
      eq(
        'parent GET skip-status for an unlinked student -> 404',
        (await api('GET', `/parent/students/${stuUnlinked.id}/skip-status`, tParent)).status,
        404
      );

      console.log('\n--- Skip Today\'s Pickup (real logic + real notification) ---');
      const soon = (await pool.query("SELECT to_char(now() + interval '65 minutes', 'HH24:MI') AS t")).rows[0].t;
      const nowHm = (await pool.query("SELECT to_char(now(), 'HH24:MI') AS t")).rows[0].t;
      const today = (await pool.query('SELECT CURRENT_DATE AS d')).rows[0].d.toISOString().slice(0, 10);

      await api('POST', '/assignments', tA1, {
        student_id: stuEligible.id, driver_user_id: driverXId, van_id: vanA.id, start_date: today, pickup_time: soon,
      });
      await api('POST', '/assignments', tA1, {
        student_id: stuIneligible.id, driver_user_id: driverXId, van_id: vanA.id, start_date: today, pickup_time: nowHm,
      });

      const statusElig = await api('GET', `/parent/students/${stuEligible.id}/skip-status`, tParent);
      eq('eligible student (pickup 65 min away) -> eligible:true', statusElig.body?.eligible, true);
      const statusInelig = await api('GET', `/parent/students/${stuIneligible.id}/skip-status`, tParent);
      eq('ineligible student (pickup ~now, past 30-min cutoff) -> eligible:false', statusInelig.body?.eligible, false);

      eq(
        'skip-pickup for the ineligible (past-cutoff) student -> 403',
        (await api('POST', `/parent/students/${stuIneligible.id}/skip-pickup`, tParent)).status,
        403
      );
      eq(
        'skip-pickup for an unlinked student -> 404',
        (await api('POST', `/parent/students/${stuUnlinked.id}/skip-pickup`, tParent)).status,
        404
      );

      mailer._reset();
      const skipRes = await api('POST', `/parent/students/${stuEligible.id}/skip-pickup`, tParent);
      (skipRes.status === 200 && skipRes.body.skipped === true)
        ? ok('skip-pickup for eligible student -> 200, skipped')
        : bad(`skip-pickup: ${skipRes.status} ${JSON.stringify(skipRes.body)}`);
      const sent = mailer._sent();
      const sentTo = sent.map((m) => m.to).sort();
      const expectRecipients = ['a1@co.com', 'a2@co.com', 'sa@sch.com', 'driverx-new@co.com'].sort();
      JSON.stringify(sentTo) === JSON.stringify(expectRecipients)
        ? ok('notified exactly: both company admins, the school admin, and the assigned driver')
        : bad(`notified: ${JSON.stringify(sentTo)}, expected ${JSON.stringify(expectRecipients)}`);

      eq(
        'skip-pickup again same day -> 409 (already skipped)',
        (await api('POST', `/parent/students/${stuEligible.id}/skip-pickup`, tParent)).status,
        409
      );

      console.log('\n--- Parent student detail (real vehicle/driver/trip info) ---');
      const detail = await api('GET', `/parent/students/${stuEligible.id}/detail`, tParent);
      (detail.status === 200 && detail.body.van?.license_plate === 'AAA-1' && detail.body.driver?.full_name === 'Driver X'
        && detail.body.skip_today === true)
        ? ok('parent detail returns real van/driver info and reflects the skip just recorded')
        : bad(`detail: ${detail.status} ${JSON.stringify(detail.body)}`);
      eq(
        'parent detail for an unlinked student -> 404',
        (await api('GET', `/parent/students/${stuUnlinked.id}/detail`, tParent)).status,
        404
      );

      console.log('\n--- Unlink ---');
      eq('unlink parent from ineligible student -> 204', (await api('DELETE', `/parent-access/${link2.body.id}`, tA1)).status, 204);
      const afterUnlink = await api('GET', '/parent/students', tParent);
      (afterUnlink.body ?? []).length === 1
        ? ok('unlinked student no longer visible to parent')
        : bad(`after unlink: ${JSON.stringify(afterUnlink.body)}`);
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
