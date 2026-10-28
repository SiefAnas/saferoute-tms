// Staff info by link: admin makes a driver / monitor link (hashed code, 3 or 7 days, revocable,
// capped submissions), the public form writes only to staff_submissions, the sender can edit until
// the admin opens it, approval matches or creates the van (a new van takes the form's color, a
// matched van keeps its own) and refuses an email that already has an account, and the setup link (24 hours, single use) lets the person choose their own password.
const PG_PORT = 5533;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-52';
process.env.NODE_ENV = 'test';
process.env.STAFF_LINK_MAX_SUBMISSIONS = '3';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const { hashToken } = require('../src/auth/tokens.js');
const mailer = require('../src/mail/mailer.js');

const rec = createRecorder('52-staff-links');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:6045';
const PW = 'Secret123!';
const NEW_PW = 'MyOwnPass9!';

async function api(method, p, token, body) {
  const opts = { method, headers: {} };
  if (token) opts.headers.authorization = `Bearer ${token}`;
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(BASE + p, opts);
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: data };
}
const login = (email, password) => api('POST', '/auth/login', null, { email, password });
const codeOf = (url) => /[?&]code=([0-9a-f]{64})$/.exec(url ?? '')?.[1];
const setupTokenFromMail = async (to) => {
  const m = (await mailer._drained()).filter((x) => x.to === to).at(-1);
  return m ? /setup-account\?token=([0-9a-f]{64})/.exec(m.text)?.[1] : undefined;
};
const count = async (sql, params) => (await pool.query(sql, params)).rows[0].n;

const driverForm = (over = {}) => ({
  full_name: 'Dana Driver', phone: '555-0101', email: 'dana@example.com',
  van_plate: 'ab-12 cd', van_make: 'Ford', van_model: 'Transit', van_color: 'Silver', van_year: 2021,
  ...over,
});

async function main() {
  const epg = await startEmbeddedPostgres('52-staff-links', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const B = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id");
    const user = (email, role, companyId) => ins(
      'INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id',
      [email, hash, email.split('@')[0], role, companyId]
    );
    await user('a1@a.com', 'company_admin', A.id);
    await user('b1@b.com', 'company_admin', B.id);
    await user('drv@a.com', 'driver', A.id);
    await user('taken@b.com', 'driver', B.id);
    // The van Co A already has: plate "AB12CD" written differently from the form's "ab-12 cd".
    const existingVan = await ins(
      "INSERT INTO vans(company_id,license_plate,brand,model,year,color) VALUES($1,'AB 12CD','Mercedes','Sprinter',2019,'White') RETURNING id",
      [A.id]
    );
    // Co B has a van with the same plate; it must never be matched for Co A.
    await ins("INSERT INTO vans(company_id,license_plate,brand,model,year,color) VALUES($1,'AB12CD','Ford','Transit',2020,'Blue')", [B.id]);

    const server = createApp().listen(6045);
    try {
      const tA = (await login('a1@a.com', PW)).body.token;
      const tB = (await login('b1@b.com', PW)).body.token;
      const tDrv = (await login('drv@a.com', PW)).body.token;

      console.log('--- admin makes links ---');
      eq('a driver cannot make a link -> 403', (await api('POST', '/staff-links', tDrv, { role: 'driver', expires_in_days: 3 })).status, 403);
      eq('expiry other than 3 or 7 days -> 400', (await api('POST', '/staff-links', tA, { role: 'driver', expires_in_days: 5 })).status, 400);
      eq('unknown role -> 400', (await api('POST', '/staff-links', tA, { role: 'parent', expires_in_days: 3 })).status, 400);
      const mk = await api('POST', '/staff-links', tA, { role: 'driver', expires_in_days: 7 });
      eq('driver link, 7 days -> 201', mk.status, 201);
      const code = codeOf(mk.body?.url);
      code ? ok('the link carries a 64-character random code') : bad(`url: ${mk.body?.url}`);
      eq('max submissions comes from config', mk.body?.link?.max_submissions, 3);
      const days = (new Date(mk.body.link.expires_at) - Date.now()) / 86400_000;
      (days > 6.9 && days <= 7) ? ok('expires in 7 days') : bad(`expires in ${days} days`);
      const stored = (await pool.query('SELECT code_hash FROM staff_links WHERE id = $1', [mk.body.link.id])).rows[0].code_hash;
      (stored === hashToken(code) && stored !== code) ? ok('only the hash of the code is stored') : bad('code stored in the clear');
      eq('no personal data in the link: just the code', mk.body.url.replace(code, ''), 'http://localhost:5173/staff-form?code=');
      const mon = await api('POST', '/staff-links', tA, { role: 'monitor', expires_in_days: 3 });
      eq('monitor link, 3 days -> 201', mon.status, 201);
      const monCode = codeOf(mon.body.url);
      const listed = await api('GET', '/staff-links', tA);
      eq('both links are listed as active', listed.body?.length, 2);
      eq('the list never shows the code', JSON.stringify(listed.body).includes(code), false);
      eq("another company can't see them", (await api('GET', '/staff-links', tB)).body.length, 0);
      eq("another company can't revoke them -> 404", (await api('POST', `/staff-links/${mk.body.link.id}/revoke`, tB)).status, 404);

      console.log('\n--- public form ---');
      const info = await api('POST', '/staff-form/link', null, { code });
      (info.status === 200 && info.body.role === 'driver' && info.body.company_name === 'Co A') ? ok('the link opens the driver form') : bad(`info: ${JSON.stringify(info.body)}`);
      eq('a made-up code -> 410', (await api('POST', '/staff-form/link', null, { code: 'f'.repeat(64) })).status, 410);
      eq('a missing field -> 400', (await api('POST', '/staff-form/submit', null, { code, ...driverForm({ van_make: '' }) })).status, 400);
      eq('a missing van color -> 400', (await api('POST', '/staff-form/submit', null, { code, ...driverForm({ van_color: ' ' }) })).status, 400);
      eq('a bad email -> 400', (await api('POST', '/staff-form/submit', null, { code, ...driverForm({ email: 'nope' }) })).status, 400);
      const usersBefore = await count('SELECT count(*)::int AS n FROM users');
      const vansBefore = await count('SELECT count(*)::int AS n FROM vans');
      const sent = await api('POST', '/staff-form/submit', null, { code, ...driverForm() });
      eq('driver form -> 201', sent.status, 201);
      const editToken = sent.body?.edit_token;
      /^[0-9a-f]{64}$/.test(editToken ?? '') ? ok('the sender gets an edit token') : bad(`token: ${editToken}`);
      eq('the form wrote no user', await count('SELECT count(*)::int AS n FROM users'), usersBefore);
      eq('the form wrote no van', await count('SELECT count(*)::int AS n FROM vans'), vansBefore);
      const removed = await api('POST', '/staff-form/submit', null, { code, ...driverForm({ email: 'extra@example.com', seat_count: 12, inspection_date: '2026-03-01' }) });
      eq('removed fields (seat count, inspection date) are ignored, not refused', removed.status, 201);
      eq('...and not echoed back', 'seat_count' in removed.body.submission.values || 'inspection_date' in removed.body.submission.values, false);
      eq('the van color is kept on the form', removed.body.submission.values.van_color, 'Silver');
      await pool.query("DELETE FROM staff_submissions WHERE email = 'extra@example.com'");
      eq('the edit token is stored hashed', await count('SELECT count(*)::int AS n FROM staff_submissions WHERE edit_token_hash = $1', [hashToken(editToken)]), 1);
      const mine = await api('POST', '/staff-form/mine', null, { code, edit_token: editToken });
      (mine.status === 200 && mine.body.values.email === 'dana@example.com' && mine.body.editable === true) ? ok('the sender can read back their own form, editable') : bad(`mine: ${JSON.stringify(mine.body)}`);
      eq('a wrong edit token -> 404', (await api('POST', '/staff-form/mine', null, { code, edit_token: 'a'.repeat(64) })).status, 404);
      eq("the edit token doesn't work with another link", (await api('POST', '/staff-form/mine', null, { code: monCode, edit_token: editToken })).status, 404);
      const edited = await api('PUT', '/staff-form/mine', null, { code, edit_token: editToken, ...driverForm({ phone: '555-0202' }) });
      (edited.status === 200 && edited.body.values.phone === '555-0202') ? ok('the sender edits their form before it is seen') : bad(`edit: ${JSON.stringify(edited.body)}`);
      const monSent = await api('POST', '/staff-form/submit', null, { code: monCode, full_name: 'Mo Monitor', phone: '555-0303', email: 'mo@example.com', van_plate: 'IGNORED' });
      eq('monitor form -> 201', monSent.status, 201);
      eq('the monitor form keeps no van fields', await count("SELECT count(*)::int AS n FROM staff_submissions WHERE email = 'mo@example.com' AND van_plate IS NULL"), 1);

      console.log('\n--- submission limit ---');
      eq('2nd form on the driver link -> 201', (await api('POST', '/staff-form/submit', null, { code, ...driverForm({ email: 'taken@b.com', full_name: 'Taken' }) })).status, 201);
      const third = await api('POST', '/staff-form/submit', null, { code, ...driverForm({ email: 'new@example.com', van_plate: 'NEW 999', full_name: 'Nia New' }) });
      eq('3rd form -> 201', third.status, 201);
      const niaToken0 = third.body.edit_token;
      const full = await api('POST', '/staff-form/submit', null, { code, ...driverForm({ email: 'four@example.com' }) });
      (full.status === 409 && full.body?.code === 'LINK_FULL') ? ok('4th form over the limit -> 409 LINK_FULL') : bad(`full: ${full.status} ${JSON.stringify(full.body)}`);
      eq('still only 3 forms on the link', await count('SELECT count(*)::int AS n FROM staff_submissions WHERE link_id = $1', [mk.body.link.id]), 3);

      console.log('\n--- admin review: seen locks editing ---');
      const subs = await api('GET', '/staff-submissions?role=driver', tA);
      eq('the Pending list has the 3 driver forms', subs.body?.length, 3);
      eq("another company's list is empty", (await api('GET', '/staff-submissions', tB)).body.length, 0);
      const dana = subs.body.find((s) => s.email === 'dana@example.com');
      eq('new forms start as "new"', dana.status, 'new');
      eq('van match: the existing van, despite different spacing', dana.van_match?.id, existingVan.id);
      eq('duplicate email is flagged on the list', subs.body.find((s) => s.email === 'taken@b.com').email_has_account, true);
      eq('no flag on a fresh email', dana.email_has_account, false);
      eq("another company can't open it -> 404", (await api('POST', `/staff-submissions/${dana.id}/seen`, tB)).status, 404);
      const seen = await api('POST', `/staff-submissions/${dana.id}/seen`, tA);
      eq('opening it marks it seen', seen.body?.status, 'seen');
      const locked = await api('PUT', '/staff-form/mine', null, { code, edit_token: editToken, ...driverForm({ phone: '555-9999' }) });
      (locked.status === 409 && locked.body?.code === 'SUBMISSION_LOCKED') ? ok('edit after seen -> 409 SUBMISSION_LOCKED') : bad(`locked: ${locked.status} ${JSON.stringify(locked.body)}`);
      eq('the phone kept its last value', (await pool.query('SELECT phone FROM staff_submissions WHERE id = $1', [dana.id])).rows[0].phone, '555-0202');
      eq('the sender sees it is no longer editable', (await api('POST', '/staff-form/mine', null, { code, edit_token: editToken })).body.editable, false);

      console.log('\n--- approve: van match, duplicate email ---');
      mailer._reset();
      const appr = await api('POST', `/staff-submissions/${dana.id}/approve`, tA);
      eq('approve -> 200', appr.status, 200);
      eq('the existing van is matched', appr.body?.van_matched, true);
      eq('...and it is that van', appr.body?.van?.id, existingVan.id);
      eq('no duplicate van was made', await count("SELECT count(*)::int AS n FROM vans WHERE company_id = $1", [A.id]), 1);
      eq('the matched van was not changed', (await pool.query('SELECT brand FROM vans WHERE id = $1', [existingVan.id])).rows[0].brand, 'Mercedes');
      eq('the matched van keeps its old color (White), not the form color (Silver)', (await pool.query('SELECT color FROM vans WHERE id = $1', [existingVan.id])).rows[0].color, 'White');
      const made = (await pool.query("SELECT * FROM users WHERE email = 'dana@example.com'")).rows[0];
      (made && made.role === 'driver' && made.company_id === A.id && made.phone === '555-0202') ? ok('a driver account was made in Co A') : bad(`user: ${JSON.stringify(made)}`);
      eq('approved again -> 409', (await api('POST', `/staff-submissions/${dana.id}/approve`, tA)).status, 409);
      eq('the list shows it approved', (await api('GET', '/staff-submissions', tA)).body.find((s) => s.id === dana.id).status, 'approved');

      const nia = subs.body.find((s) => s.email === 'new@example.com');
      eq('the sender changes the van color before review', (await api('PUT', '/staff-form/mine', null, { code, edit_token: niaToken0, ...driverForm({ email: 'new@example.com', van_plate: 'NEW 999', full_name: 'Nia New', van_color: 'Dark Blue' }) })).body?.values?.van_color, 'Dark Blue');
      const niaAppr = await api('POST', `/staff-submissions/${nia.id}/approve`, tA);
      (niaAppr.status === 200 && niaAppr.body.van_matched === false) ? ok('a new plate makes a new van') : bad(`nia: ${JSON.stringify(niaAppr.body)}`);
      const newVan = (await pool.query('SELECT * FROM vans WHERE id = $1', [niaAppr.body.van.id])).rows[0];
      (newVan.company_id === A.id && newVan.brand === 'Ford' && newVan.model === 'Transit' && newVan.year === 2021) ? ok('the new van has the form\'s details') : bad(`van: ${JSON.stringify(newVan)}`);
      eq('the new van is saved with the form\'s color', newVan.color, 'Dark Blue');
      eq('the vans table has no seat_count column', 'seat_count' in newVan, false);
      eq('the new van got the built-in maintenance items, like any new van', await count('SELECT count(*)::int AS n FROM maintenance_items WHERE van_id = $1', [newVan.id]), 4);
      eq('nothing from the form set a fleet inspection date', await count('SELECT count(*)::int AS n FROM maintenance_items WHERE van_id = $1 AND due_date IS NOT NULL', [newVan.id]), 0);

      const taken = subs.body.find((s) => s.email === 'taken@b.com');
      const dup = await api('POST', `/staff-submissions/${taken.id}/approve`, tA);
      (dup.status === 409 && dup.body?.code === 'EMAIL_HAS_ACCOUNT') ? ok('an email with an account -> 409 EMAIL_HAS_ACCOUNT') : bad(`dup: ${dup.status} ${JSON.stringify(dup.body)}`);
      eq('no second account was made', await count("SELECT count(*)::int AS n FROM users WHERE lower(email) = 'taken@b.com'"), 1);
      eq('the form stays open for the admin to decide', (await pool.query('SELECT status FROM staff_submissions WHERE id = $1', [taken.id])).rows[0].status, 'new');
      eq('no van was made either', await count("SELECT count(*)::int AS n FROM vans WHERE company_id = $1", [A.id]), 2);
      eq('reject -> 200', (await api('POST', `/staff-submissions/${taken.id}/reject`, tA)).body?.status, 'rejected');

      console.log('\n--- setup link: choose own password, once, within 24 hours ---');
      const setupToken = await setupTokenFromMail('dana@example.com');
      setupToken ? ok('the approval email has a setup link') : bad('no setup email');
      const mail = (await mailer._drained()).find((m) => m.to === 'dana@example.com');
      eq('no password in the email', /password:/i.test(mail.text), false);
      eq('the setup token is stored hashed', await count('SELECT count(*)::int AS n FROM account_setup_tokens WHERE token_hash = $1', [hashToken(setupToken)]), 1);
      const ttl = (await pool.query("SELECT extract(epoch FROM expires_at - created_at)::int AS s FROM account_setup_tokens WHERE token_hash = $1", [hashToken(setupToken)])).rows[0].s;
      eq('the setup link lasts 24 hours', ttl, 24 * 3600);
      eq('before setup the person cannot sign in', (await login('dana@example.com', NEW_PW)).status, 401);
      eq('a weak password -> 400', (await api('POST', '/auth/setup-account', null, { token: setupToken, newPassword: 'weak' })).status, 400);
      eq('setup -> 200', (await api('POST', '/auth/setup-account', null, { token: setupToken, newPassword: NEW_PW })).status, 200);
      const signedIn = await login('dana@example.com', NEW_PW);
      (signedIn.status === 200 && signedIn.body.user.must_change_password === false) ? ok('they sign in with the password they chose') : bad(`login: ${JSON.stringify(signedIn.body)}`);
      const reuse = await api('POST', '/auth/setup-account', null, { token: setupToken, newPassword: 'Another1!x' });
      (reuse.status === 400 && reuse.body?.code === 'SETUP_LINK_INVALID') ? ok('reusing the setup link -> 400 SETUP_LINK_INVALID') : bad(`reuse: ${reuse.status} ${JSON.stringify(reuse.body)}`);
      eq('the reuse changed nothing: own password still works', (await login('dana@example.com', NEW_PW)).status, 200);
      eq('resend after setup -> 409', (await api('POST', `/staff-submissions/${dana.id}/resend-setup`, tA)).status, 409);

      const niaToken = await setupTokenFromMail('new@example.com');
      await pool.query("UPDATE account_setup_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [hashToken(niaToken)]);
      const expired = await api('POST', '/auth/setup-account', null, { token: niaToken, newPassword: NEW_PW });
      (expired.status === 400 && expired.body?.code === 'SETUP_LINK_INVALID') ? ok('an expired setup link -> 400 SETUP_LINK_INVALID') : bad(`expired: ${expired.status} ${JSON.stringify(expired.body)}`);
      eq('the expired link set no password', (await login('new@example.com', NEW_PW)).status, 401);
      mailer._reset();
      eq('resend gives a fresh link -> 200', (await api('POST', `/staff-submissions/${nia.id}/resend-setup`, tA)).status, 200);
      const fresh = await setupTokenFromMail('new@example.com');
      eq('the fresh link works', (await api('POST', '/auth/setup-account', null, { token: fresh, newPassword: NEW_PW })).status, 200);

      console.log('\n--- revoked and expired links stop at once ---');
      const mk2 = await api('POST', '/staff-links', tA, { role: 'driver', expires_in_days: 3 });
      const code2 = codeOf(mk2.body.url);
      const early = await api('POST', '/staff-form/submit', null, { code: code2, ...driverForm({ email: 'early@example.com' }) });
      eq('form on the new link -> 201', early.status, 201);
      eq('revoke -> 200', (await api('POST', `/staff-links/${mk2.body.link.id}/revoke`, tA)).status, 200);
      const rev = await api('POST', '/staff-form/submit', null, { code: code2, ...driverForm({ email: 'late@example.com' }) });
      (rev.status === 410 && rev.body?.code === 'LINK_INACTIVE') ? ok('submit on a revoked link -> 410 LINK_INACTIVE') : bad(`revoked: ${rev.status} ${JSON.stringify(rev.body)}`);
      eq('the revoked link no longer opens the form', (await api('POST', '/staff-form/link', null, { code: code2 })).status, 410);
      eq('editing on a revoked link -> 410', (await api('PUT', '/staff-form/mine', null, { code: code2, edit_token: early.body.edit_token, ...driverForm({ email: 'early@example.com' }) })).status, 410);
      eq('the revoked link drops out of the active list', (await api('GET', '/staff-links', tA)).body.some((l) => l.id === mk2.body.link.id), false);

      await pool.query("UPDATE staff_links SET expires_at = now() - interval '1 second' WHERE id = $1", [mon.body.link.id]);
      const exp = await api('POST', '/staff-form/submit', null, { code: monCode, full_name: 'Late Mo', phone: '555-0404', email: 'latemo@example.com' });
      (exp.status === 410 && exp.body?.code === 'LINK_INACTIVE') ? ok('submit on an expired link -> 410 LINK_INACTIVE') : bad(`expired link: ${exp.status} ${JSON.stringify(exp.body)}`);
      eq('the expired link no longer opens the form', (await api('POST', '/staff-form/link', null, { code: monCode })).status, 410);
      eq('the expired link drops out of the active list', (await api('GET', '/staff-links', tA)).body.some((l) => l.id === mon.body.link.id), false);
      eq('nothing was saved from the dead links', await count("SELECT count(*)::int AS n FROM staff_submissions WHERE email IN ('late@example.com', 'latemo@example.com')"), 0);

      console.log('\n--- monitor approval ---');
      const mo = (await api('GET', '/staff-submissions?role=monitor', tA)).body[0];
      const moAppr = await api('POST', `/staff-submissions/${mo.id}/approve`, tA);
      (moAppr.status === 200 && moAppr.body.user.role === 'monitor' && moAppr.body.van === null) ? ok('a monitor form makes a monitor account and no van') : bad(`mo: ${JSON.stringify(moAppr.body)}`);
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
