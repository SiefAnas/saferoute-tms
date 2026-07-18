// Step 3 (claim slice) — self-serve signup, placeholder claim + email verification,
// creator edit-rights before/after claim, and the operate-rights-after-takeover regression.
const PG_PORT = 5452;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-03';
process.env.NODE_ENV = 'test'; // silence mailer console; still records messages

const express = require('express');
const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const pool = require('../src/db/pool.js');
const authenticate = require('../src/middleware/authenticate.js');
const attachScopedDb = require('../src/middleware/tenant.js');
const { requireOperable } = require('../src/middleware/authorize.js');
const authRoutes = require('../src/routes/auth.js');
const signupRoutes = require('../src/routes/signup.js');
const placeholderRoutes = require('../src/routes/placeholders.js');
const { hashPassword } = require('../src/auth/password.js');
const mailer = require('../src/mail/mailer.js');

const rec = createRecorder('03-claim');
const { ok, bad } = rec;
const BASE = 'http://localhost:4300';
const PW = 'Secret123!';

const j = (r) => r.json().catch(() => ({}));
const post = (p, body, headers = {}) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const patch = (p, body, headers = {}) => fetch(`${BASE}${p}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (p, headers = {}) => fetch(`${BASE}${p}`, { headers });
const bearer = (t) => ({ authorization: `Bearer ${t}` });
// grab the raw token the mailer "sent" to an address
const tokenFor = (email) => {
  const m = [...mailer._sent()].reverse().find((x) => x.to === email && /token:/.test(x.text));
  return m ? m.text.match(/token:\s*([a-f0-9]+)/)[1] : null;
};

async function main() {
  const epg = await startEmbeddedPostgres('03-claim', PG_PORT);
  try {
    runMigrateUp();

    // Seed: a company_admin (the "partner") who created an UNCLAIMED school placeholder.
    const pwHash = await hashPassword(PW);
    const creator = (await pool.query(
      "INSERT INTO companies(name,claim_status,claimed_at) VALUES('Partner Bus Co','claimed',now()) RETURNING id"
    )).rows[0];
    const creatorUser = (await pool.query(
      "INSERT INTO users(email,password_hash,full_name,role,company_id) VALUES('partner@x.com',$1,'Partner','company_admin',$2) RETURNING id",
      [pwHash, creator.id]
    )).rows[0];
    // A second, unrelated company_admin (to prove non-creators can't edit either).
    const otherCo = (await pool.query("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Other Co','claimed',now()) RETURNING id")).rows[0];
    await pool.query("INSERT INTO users(email,password_hash,full_name,role,company_id) VALUES('other@x.com',$1,'Other','company_admin',$2)", [pwHash, otherCo.id]);
    await pool.query(
      "INSERT INTO schools(name,address,claim_status,created_by_user_id) VALUES('Willow Creek Elementary','12 Oak St','unclaimed',$1)",
      [creatorUser.id]
    );

    const app = express();
    app.use(express.json());
    app.use('/auth', authRoutes);
    app.use('/signup', signupRoutes);
    app.use('/placeholders', placeholderRoutes);
    // a data route guarded by the operate-rights gate
    app.get('/t/students', authenticate, requireOperable, attachScopedDb, async (req, res, next) => {
      try { res.json(await req.db.findMany('students')); } catch (e) { next(e); }
    });
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
    const server = app.listen(4300);

    try {
      console.log('--- Claimable fuzzy search (trigram) ---');
      const search = await j(await get('/signup/school/claimable?name=willow%20creek%20elem'));
      (search.candidates?.length === 1 && search.candidates[0].name === 'Willow Creek Elementary')
        ? ok('fuzzy search finds the unclaimed placeholder') : bad(`search wrong: ${JSON.stringify(search)}`);
      (search.candidates[0].addedByPartner === true && !('created_by_user_id' in search.candidates[0]))
        ? ok('candidate exposes minimal fields (no creator identity)') : bad('candidate leaks fields');
      const claimId = search.candidates[0].id;

      console.log('\n--- [#4] Creator CAN edit core info while unclaimed ---');
      const creatorTok = (await j(await post('/auth/login', { email: 'partner@x.com', password: PW }))).token;
      const otherTok = (await j(await post('/auth/login', { email: 'other@x.com', password: PW }))).token;
      const edit1 = await patch(`/placeholders/school/${claimId}`, { address: '99 New Rd' }, bearer(creatorTok));
      (edit1.status === 200 && (await j(edit1)).address === '99 New Rd') ? ok('creator edits placeholder while unclaimed -> 200') : bad(`creator edit while unclaimed failed: ${edit1.status}`);
      (await patch(`/placeholders/school/${claimId}`, { address: 'hijack' }, bearer(otherTok))).status === 403 ? ok('non-creator edit -> 403') : bad('non-creator was allowed to edit');

      console.log('\n--- Claim signup -> pending, not operational ---');
      const claim = await post('/signup/school', { claimId, fullName: 'Head Teacher', email: 'head@willow.edu', password: PW });
      const claimBody = await j(claim);
      (claim.status === 201 && claimBody.mode === 'pending_claim') ? ok('claim signup -> 201 pending_claim') : bad(`claim signup wrong: ${claim.status} ${JSON.stringify(claimBody)}`);
      const st1 = (await pool.query('SELECT claim_status FROM schools WHERE id=$1', [claimId])).rows[0].claim_status;
      st1 === 'pending_claim' ? ok('placeholder locked to pending_claim') : bad(`status=${st1}`);

      console.log('\n--- Concurrency: second claim on same placeholder rejected ---');
      const dup = await post('/signup/school', { claimId, fullName: 'Other', email: 'other@willow.edu', password: PW });
      dup.status === 409 ? ok('second concurrent claim -> 409') : bad(`dup claim status ${dup.status}`);

      console.log('\n--- Operate-rights gate blocks pending user ---');
      const login1 = await j(await post('/auth/login', { email: 'head@willow.edu', password: PW }));
      login1.token ? ok('pending user can still authenticate') : bad('pending user cannot log in');
      const blocked = await get('/t/students', bearer(login1.token));
      blocked.status === 403 ? ok('pending user blocked from data route (403)') : bad(`pending user not blocked: ${blocked.status}`);

      console.log('\n--- Verify email -> claim finalized + creator notified ---');
      const rawToken = tokenFor('head@willow.edu');
      rawToken ? ok('verification token was emailed (captured from mailer)') : bad('no token captured');
      const ver = await j(await post('/auth/verify-email', { token: rawToken }));
      (ver.verified && ver.claimFinalized) ? ok('verify-email -> claim finalized') : bad(`verify result: ${JSON.stringify(ver)}`);
      const st2 = (await pool.query('SELECT claim_status, claimed_by_user_id FROM schools WHERE id=$1', [claimId])).rows[0];
      st2.claim_status === 'claimed' ? ok('placeholder now claimed') : bad(`status=${st2.claim_status}`);
      mailer._sent().some((m) => m.to === 'partner@x.com' && /claimed/i.test(m.subject))
        ? ok('placeholder creator notified of the claim') : bad('creator not notified');

      console.log('\n--- [#4] Creator LOSES edit rights once claimed ---');
      const edit2 = await patch(`/placeholders/school/${claimId}`, { address: 'too late' }, bearer(creatorTok));
      edit2.status === 403 ? ok('creator edit after claim -> 403 (rights revoked)') : bad(`creator still editable after claim: ${edit2.status}`);
      const stillAddr = (await pool.query('SELECT address FROM schools WHERE id=$1', [claimId])).rows[0].address;
      stillAddr === '99 New Rd' ? ok('post-claim edit did not mutate the record') : bad(`address changed to: ${stillAddr}`);

      console.log('\n--- Now operational ---');
      const login2 = await j(await post('/auth/login', { email: 'head@willow.edu', password: PW }));
      const nowOk = await get('/t/students', bearer(login2.token));
      nowOk.status === 200 ? ok('after verify, data route allowed (200)') : bad(`still blocked: ${nowOk.status}`);

      console.log('\n--- Reused/invalid token rejected ---');
      (await post('/auth/verify-email', { token: rawToken })).status === 400 ? ok('reused token -> 400') : bad('reused token accepted');

      console.log('\n--- Fresh signup (no claim) -> operational immediately ---');
      const fresh = await post('/signup/company', { orgName: '3 Bees Transport', fullName: 'Owner', email: 'owner@3bees.com', password: PW });
      const freshBody = await j(fresh);
      (fresh.status === 201 && freshBody.mode === 'created' && freshBody.token) ? ok('fresh signup -> 201 created + token (operational)') : bad(`fresh signup wrong: ${fresh.status} ${JSON.stringify(freshBody)}`);
      (await post('/signup/company', { orgName: 'Dup', fullName: 'x', email: 'owner@3bees.com', password: PW })).status === 409 ? ok('duplicate email -> 409') : bad('duplicate email allowed');

      console.log('\n--- Claimed placeholder no longer appears in search ---');
      const search2 = await j(await get('/signup/school/claimable?name=willow%20creek%20elem'));
      (search2.candidates?.length === 0) ? ok('claimed placeholder excluded from claimable search') : bad('claimed placeholder still searchable');

      console.log('\n--- [#1 regression] takeover does NOT grant the losing claimant operate-rights ---');
      const p2 = (await pool.query(
        "INSERT INTO schools(name,address,claim_status,created_by_user_id) VALUES('Maple Ridge School','5 Elm St','unclaimed',$1) RETURNING id",
        [creatorUser.id]
      )).rows[0];
      // Claimant A claims, then never verifies.
      await post('/signup/school', { claimId: p2.id, fullName: 'Claimant A', email: 'a@maple.edu', password: PW });
      // Force the 24h pending lock to expire.
      await pool.query("UPDATE schools SET claim_expires_at = now() - interval '1 hour' WHERE id = $1", [p2.id]);
      // Claimant B takes over the expired pending claim and verifies.
      const bClaim = await post('/signup/school', { claimId: p2.id, fullName: 'Claimant B', email: 'b@maple.edu', password: PW });
      bClaim.status === 201 ? ok('B takes over expired pending claim -> 201') : bad(`takeover failed: ${bClaim.status}`);
      await post('/auth/verify-email', { token: tokenFor('b@maple.edu') });
      // A (never verified, still attached to the now-claimed org) must NOT get operate-rights.
      // Since the defense-in-depth fix (BACKLOG), the losing claimant is deactivated outright
      // on finalize, so login itself now fails (401) rather than succeeding and being blocked
      // downstream by requireOperable (403, the pre-fix behavior) — a strictly stronger result.
      const aLogin = await post('/auth/login', { email: 'a@maple.edu', password: PW });
      aLogin.status === 401 ? ok('losing claimant A deactivated -> cannot even log in (401)') : bad(`A unexpectedly logged in: ${aLogin.status}`);
      const bLogin = await j(await post('/auth/login', { email: 'b@maple.edu', password: PW }));
      const bAccess = await get('/t/students', bearer(bLogin.token));
      bAccess.status === 200 ? ok('winning verified claimant B operates (200)') : bad(`B blocked: ${bAccess.status}`);
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
