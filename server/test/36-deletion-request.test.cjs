// Data deletion requests (branch account-settings): POST /users/me/deletion-request records one
// open request per driver / monitor / parent / company admin (against the company) and per school
// admin / school staff (against the school, migration 033), and emails SafeTurns support plus the
// org's other active admins (never the requester); a second open request is refused; GET shows
// the open one. Nothing is deleted.
const PG_PORT = 5494;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-36';
process.env.NODE_ENV = 'test';
process.env.SUPPORT_EMAIL = 'support@safeturns.com';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const config = require('../src/config.js');
const { hashPassword } = require('../src/auth/password.js');
const mailer = require('../src/mail/mailer.js');

const rec = createRecorder('36-deletion-request');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5995';
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
const login = (email) => api('POST', '/auth/login', null, { email, password: PW }).then((r) => r.body.token);

async function main() {
  const epg = await startEmbeddedPostgres('36-deletion-request', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const q = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await q("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Acme Rides','claimed',now()) RETURNING id");
    const B = await q("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Other Co','claimed',now()) RETURNING id");
    const S = await q("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const user = (email, role, col, id, name = email) => q(
      `INSERT INTO users(email,password_hash,full_name,role,${col},email_verified_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id`,
      [email, hash, name, role, id]
    );
    await user('admin1@a.com', 'company_admin', 'company_id', A.id);
    await user('admin2@a.com', 'company_admin', 'company_id', A.id);
    const gone = await user('gone-admin@a.com', 'company_admin', 'company_id', A.id);
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [gone.id]);
    await user('admin@b.com', 'company_admin', 'company_id', B.id);
    const parent = await user('parent@a.com', 'parent', 'company_id', A.id, 'Pat Parent');
    await user('driver@a.com', 'driver', 'company_id', A.id, 'Dee Driver');
    await user('monitor@a.com', 'monitor', 'company_id', A.id);
    const S2 = await q("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School Two','claimed',now()) RETURNING id");
    const staff = await user('staff@s.com', 'school_staff', 'school_id', S.id, 'Sam Staff');
    const sadmin = await user('sadmin@s.com', 'school_admin', 'school_id', S.id, 'Sid Admin');
    await user('sadmin2@s.com', 'school_admin', 'school_id', S.id);
    const goneS = await user('gone-sadmin@s.com', 'school_admin', 'school_id', S.id);
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [goneS.id]);
    await user('sadmin@s2.com', 'school_admin', 'school_id', S2.id);
    await q("INSERT INTO students(company_id,school_id,full_name,grade) VALUES($1,$2,'Kid','3')", [A.id, S.id]);
    const before = (await q('SELECT (SELECT count(*) FROM users)::int + (SELECT count(*) FROM students)::int AS n')).n;

    const server = createApp().listen(5995);
    try {
      const tP = await login('parent@a.com');
      const tD = await login('driver@a.com');
      const tM = await login('monitor@a.com');

      console.log('--- happy path ---');
      eq('GET before asking -> { request: null }', JSON.stringify((await api('GET', '/users/me/deletion-request', tP)).body), JSON.stringify({ request: null }));
      mailer._reset();
      const created = await api('POST', '/users/me/deletion-request', tP, { reason: '  We moved away.  ' });
      eq('POST -> 201', created.status, 201);
      const r = created.body?.request;
      (r && r.status === 'open' && r.reason === 'We moved away.' && r.requested_at && r.id) ? ok('response: open request, reason trimmed') : bad(`created: ${JSON.stringify(created.body)}`);
      const row = await q('SELECT user_id, company_id, reason, status, handled_at, handled_by, requested_at > now() - interval \'1 minute\' AS recent FROM deletion_requests WHERE id = $1', [r?.id]);
      eq('row: user, company, reason, status open, not handled', JSON.stringify([row.user_id, row.company_id, row.reason, row.status, row.handled_at, row.handled_by, row.recent]), JSON.stringify([parent.id, A.id, 'We moved away.', 'open', null, null, true]));
      const sent = await mailer._drained();
      eq('emails: support + the two active admins of the same company', sent.map((m) => m.to).sort().join(','), 'admin1@a.com,admin2@a.com,support@safeturns.com');
      const m = sent[0];
      (/Pat Parent/.test(m.subject) && /Acme Rides/.test(m.subject) && /parent, parent@a\.com/.test(m.text) && /We moved away\./.test(m.text) && m.text.includes(r.id))
        ? ok('email names the person, role, company, reason and request id') : bad(`mail: ${m.subject} / ${m.text}`);
      eq('the email says nothing was deleted', /Nothing has been deleted/.test(m.text), true);
      eq('GET now shows the open request', (await api('GET', '/users/me/deletion-request', tP)).body?.request?.id, r.id);

      console.log('\n--- duplicate ---');
      mailer._reset();
      const dup = await api('POST', '/users/me/deletion-request', tP, { reason: 'again' });
      eq('second request while one is open -> 409', `${dup.status} ${dup.body?.error}`, '409 you already have an open deletion request');
      eq('still exactly one request for the parent', (await q('SELECT count(*)::int AS n FROM deletion_requests WHERE user_id = $1', [parent.id])).n, 1);
      eq('no emails for the refused duplicate', (await mailer._drained()).length, 0);
      const race = await Promise.all([1, 2, 3].map(() => api('POST', '/users/me/deletion-request', tD, {})));
      eq('three at once from the driver: one 201, two 409', race.map((x) => x.status).sort().join(','), '201,409,409');
      await pool.query("UPDATE deletion_requests SET status = 'closed', handled_at = now(), handled_by = 'test' WHERE user_id = $1", [parent.id]);
      eq('after the open one is closed (by hand), a new one is allowed', (await api('POST', '/users/me/deletion-request', tP, {})).status, 201);

      console.log('\n--- input and roles ---');
      eq('no reason is fine (monitor) -> 201, reason null', JSON.stringify(await api('POST', '/users/me/deletion-request', tM, { reason: '   ' }).then((x) => [x.status, x.body?.request?.reason])), JSON.stringify([201, null]));
      await pool.query("UPDATE deletion_requests SET status = 'closed' WHERE status = 'open'");
      eq('reason of 501 characters -> 400', (await api('POST', '/users/me/deletion-request', tM, { reason: 'x'.repeat(501) })).status, 400);
      eq('reason of exactly 500 -> 201', (await api('POST', '/users/me/deletion-request', tM, { reason: 'x'.repeat(500) })).status, 201);
      eq('reason as a number -> 400', (await api('POST', '/users/me/deletion-request', tD, { reason: 5 })).status, 400);
      eq('no token -> 401', (await api('POST', '/users/me/deletion-request', null, {})).status, 401);

      console.log('\n--- company admin ---');
      // Closing the company is no exit for one admin, so admins can ask too.
      const tA = await login('admin1@a.com');
      const admin1 = await q("SELECT id FROM users WHERE email = 'admin1@a.com'");
      eq('company admin: GET before asking -> { request: null }', JSON.stringify((await api('GET', '/users/me/deletion-request', tA)).body), JSON.stringify({ request: null }));
      mailer._reset();
      const aReq = await api('POST', '/users/me/deletion-request', tA, { reason: 'Handing over to admin2.' });
      eq('company admin: POST -> 201', aReq.status, 201);
      const aRow = await q('SELECT user_id, company_id, school_id, reason, status FROM deletion_requests WHERE id = $1', [aReq.body?.request?.id]);
      eq('company admin row: company recorded, no school', JSON.stringify([aRow?.user_id, aRow?.company_id, aRow?.school_id, aRow?.reason, aRow?.status]), JSON.stringify([admin1.id, A.id, null, 'Handing over to admin2.', 'open']));
      const aSent = await mailer._drained();
      eq('company admin emails: support + the other active admin only (not the requester, not the inactive admin, not company B)', aSent.map((x) => x.to).sort().join(','), 'admin2@a.com,support@safeturns.com');
      /company admin, admin1@a\.com/.test(aSent[0]?.text) && aSent[0].text.includes(aReq.body.request.id)
        ? ok('company admin email names the role and request id') : bad(`mail: ${aSent[0]?.text}`);
      eq('company admin: GET shows the open request', (await api('GET', '/users/me/deletion-request', tA)).body?.request?.id, aReq.body.request.id);
      mailer._reset();
      const aDup = await api('POST', '/users/me/deletion-request', tA, { reason: 'again' });
      eq('company admin: second request while one is open -> 409', `${aDup.status} ${aDup.body?.error}`, '409 you already have an open deletion request');
      eq('company admin: still exactly one request', (await q('SELECT count(*)::int AS n FROM deletion_requests WHERE user_id = $1', [admin1.id])).n, 1);
      eq('company admin: no emails for the refused duplicate', (await mailer._drained()).length, 0);
      const tA2 = await login('admin2@a.com');
      const a2Race = await Promise.all([1, 2, 3].map(() => api('POST', '/users/me/deletion-request', tA2, {})));
      eq('second company admin, three at once: one 201, two 409', a2Race.map((x) => x.status).sort().join(','), '201,409,409');
      await pool.query("UPDATE deletion_requests SET status = 'closed' WHERE user_id IN ($1, (SELECT id FROM users WHERE email = 'admin2@a.com'))", [admin1.id]);

      console.log('\n--- school staff ---');
      const tS = await login('staff@s.com');
      eq('staff: GET before asking -> { request: null }', JSON.stringify((await api('GET', '/users/me/deletion-request', tS)).body), JSON.stringify({ request: null }));
      mailer._reset();
      const sReq = await api('POST', '/users/me/deletion-request', tS, { reason: 'Leaving the district.' });
      eq('staff: POST -> 201', sReq.status, 201);
      const sRow = await q('SELECT user_id, company_id, school_id, reason, status FROM deletion_requests WHERE id = $1', [sReq.body?.request?.id]);
      eq('staff row: school recorded, no company', JSON.stringify([sRow?.user_id, sRow?.company_id, sRow?.school_id, sRow?.reason, sRow?.status]), JSON.stringify([staff.id, null, S.id, 'Leaving the district.', 'open']));
      const sSent = await mailer._drained();
      eq('staff emails: support + the two active admins of that school only', sSent.map((x) => x.to).sort().join(','), 'sadmin2@s.com,sadmin@s.com,support@safeturns.com');
      const sm = sSent[0];
      (/Sam Staff/.test(sm.subject) && /School S/.test(sm.subject) && /school staff, staff@s\.com/.test(sm.text) && sm.text.includes(sReq.body.request.id) && /the school's admins/.test(sm.text))
        ? ok('staff email names the person, role, school and request id') : bad(`mail: ${sm.subject} / ${sm.text}`);
      eq('staff: GET shows the open request', (await api('GET', '/users/me/deletion-request', tS)).body?.request?.id, sReq.body.request.id);
      mailer._reset();
      const sDup = await api('POST', '/users/me/deletion-request', tS, { reason: 'again' });
      eq('staff: second request while one is open -> 409', `${sDup.status} ${sDup.body?.error}`, '409 you already have an open deletion request');
      eq('staff: still exactly one request', (await q('SELECT count(*)::int AS n FROM deletion_requests WHERE user_id = $1', [staff.id])).n, 1);
      eq('staff: no emails for the refused duplicate', (await mailer._drained()).length, 0);
      await pool.query("UPDATE deletion_requests SET status = 'closed' WHERE user_id = $1", [staff.id]);
      eq('staff: after the open one is closed, a new one is allowed', (await api('POST', '/users/me/deletion-request', tS, {})).status, 201);

      console.log('\n--- school admin ---');
      const tSA = await login('sadmin@s.com');
      mailer._reset();
      const saRace = await Promise.all([1, 2, 3].map(() => api('POST', '/users/me/deletion-request', tSA, {})));
      eq('school admin, three at once: one 201, two 409', saRace.map((x) => x.status).sort().join(','), '201,409,409');
      const saRow = await q("SELECT company_id, school_id FROM deletion_requests WHERE user_id = $1 AND status = 'open'", [sadmin.id]);
      eq('school admin row: school recorded, no company', JSON.stringify([saRow?.company_id, saRow?.school_id]), JSON.stringify([null, S.id]));
      eq('school admin emails: support + the other active admin, not themselves', (await mailer._drained()).map((x) => x.to).sort().join(','), 'sadmin2@s.com,support@safeturns.com');

      console.log('\n--- constraint: exactly one of company / school ---');
      const tryInsert = async (companyId, schoolId) => {
        try {
          await pool.query("INSERT INTO deletion_requests (user_id, company_id, school_id, status) VALUES ($1, $2, $3, 'closed')", [staff.id, companyId, schoolId]);
          return 'inserted';
        } catch (e) { return e.constraint || e.code; }
      };
      eq('both company and school -> refused', await tryInsert(A.id, S.id), 'deletion_requests_one_owner');
      eq('neither company nor school -> refused', await tryInsert(null, null), 'deletion_requests_one_owner');
      eq('school only -> allowed', await tryInsert(null, S.id), 'inserted');
      eq('company only -> allowed', await tryInsert(A.id, null), 'inserted');

      console.log('\n--- without SUPPORT_EMAIL ---');
      config.supportEmail = null;
      await pool.query("UPDATE deletion_requests SET status = 'closed' WHERE status = 'open'");
      mailer._reset();
      const errors = [];
      const realError = console.error;
      console.error = (...a) => errors.push(a.join(' '));
      const noSupport = await api('POST', '/users/me/deletion-request', tP, {});
      console.error = realError;
      eq('still recorded -> 201', noSupport.status, 201);
      eq('admins still emailed, support not', (await mailer._drained()).map((x) => x.to).sort().join(','), 'admin1@a.com,admin2@a.com');
      errors.some((e) => /SUPPORT_EMAIL is not set/.test(e) && e.includes(noSupport.body.request.id)) ? ok('logged loudly with the request id') : bad(`errors: ${errors.join(' | ')}`);

      eq('nothing deleted anywhere', (await q('SELECT (SELECT count(*) FROM users)::int + (SELECT count(*) FROM students)::int AS n')).n, before);
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
