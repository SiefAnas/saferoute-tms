// Step 3 (claim slice) — self-serve signup, placeholder claim REQUESTS (self-claim is refused
// since the 2026-09-30 security fix; the owner approves), creator edit-rights before/after
// claim, and old half-finished self-claims never gaining access.
const PG_PORT = 5452;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-03';
process.env.NODE_ENV = 'test'; // silence mailer console; still records messages

const express = require('express');
const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const LEGAL = require('../src/services/legal.js').currentVersions();
const pool = require('../src/db/pool.js');
const authenticate = require('../src/middleware/authenticate.js');
const attachScopedDb = require('../src/middleware/tenant.js');
const { requireOperable } = require('../src/middleware/authorize.js');
const authRoutes = require('../src/routes/auth.js');
const signupRoutes = require('../src/routes/signup.js');
const placeholderRoutes = require('../src/routes/placeholders.js');
const { hashPassword } = require('../src/auth/password.js');
const mailer = require('../src/mail/mailer.js');
const { approveClaimRequest } = require('../src/services/claimRequests.js');
const { hashToken } = require('../src/auth/tokens.js');

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
const tokenFor = async (email) => {
  const m = [...(await mailer._drained())].reverse().find((x) => x.to === email && /token:/.test(x.text));
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

      console.log('\n--- Self-claim is refused ---');
      const claim = await post('/signup/school', { claimId, fullName: 'Head Teacher', email: 'head@willow.edu', password: PW });
      const claimBody = await j(claim);
      (claim.status === 403 && /claim request/.test(claimBody.error)) ? ok('claim signup -> 403, pointing to a claim request') : bad(`claim signup: ${claim.status} ${JSON.stringify(claimBody)}`);
      (await pool.query("SELECT count(*)::int AS n FROM users WHERE email='head@willow.edu'")).rows[0].n === 0 ? ok('no account created') : bad('account created');
      (await pool.query('SELECT claim_status FROM schools WHERE id=$1', [claimId])).rows[0].claim_status === 'unclaimed' ? ok('placeholder still unclaimed') : bad('placeholder state changed');

      console.log('\n--- Claim request -> recorded, grants nothing ---');
      const reqRes = await post('/signup/school/claim-requests', { claimId, fullName: 'Head Teacher', email: 'head@willow.edu', phone: '555-0100', note: 'I run the office' });
      reqRes.status === 202 ? ok('claim request -> 202') : bad(`claim request status ${reqRes.status}`);
      const stored = (await pool.query("SELECT * FROM placeholder_claim_requests WHERE requester_email='head@willow.edu'")).rows;
      (stored.length === 1 && stored[0].org_id === claimId && stored[0].org_kind === 'school' && stored[0].status === 'pending' && stored[0].created_at)
        ? ok('request recorded: who, which placeholder, when, pending') : bad(`stored: ${JSON.stringify(stored)}`);
      (await post('/signup/school/claim-requests', { claimId, fullName: 'Head Teacher', email: 'HEAD@willow.edu' })).status === 202 ? ok('asking again -> 202') : bad('repeat request failed');
      (await pool.query("SELECT count(*)::int AS n FROM placeholder_claim_requests WHERE lower(requester_email)='head@willow.edu'")).rows[0].n === 1 ? ok('asking again adds no second row') : bad('duplicate request row');
      (await post('/auth/login', { email: 'head@willow.edu', password: PW })).status === 401 ? ok('requester has no login') : bad('requester can log in');
      (await pool.query('SELECT claim_status FROM schools WHERE id=$1', [claimId])).rows[0].claim_status === 'unclaimed' ? ok('placeholder still unclaimed after the request') : bad('request changed the placeholder');
      (await post('/signup/school/claim-requests', { claimId: creator.id, fullName: 'X', email: 'x@x.test' })).status === 409 ? ok('request with a company id as a school -> 409') : bad('wrong-kind id accepted');

      console.log('\n--- Owner approves -> account + claim ---');
      const approved = await approveClaimRequest(stored[0].id, { decidedBy: 'Test Owner' });
      (approved.user.role === 'school_admin' && approved.temporaryPassword) ? ok('approval creates the school_admin with a temporary password') : bad(`approve: ${JSON.stringify(approved)}`);
      const st2 = (await pool.query('SELECT claim_status, claimed_by_user_id FROM schools WHERE id=$1', [claimId])).rows[0];
      (st2.claim_status === 'claimed' && st2.claimed_by_user_id === approved.user.id) ? ok('placeholder now claimed by the approved account') : bad(`status=${st2.claim_status}`);
      (await pool.query('SELECT decided_by FROM placeholder_claim_requests WHERE id=$1', [stored[0].id])).rows[0].decided_by === 'Test Owner' ? ok('who approved is recorded') : bad('decider missing');
      let twice = null;
      try { await approveClaimRequest(stored[0].id, { decidedBy: 'Test Owner' }); } catch (e) { twice = e.status; }
      twice === 409 ? ok('approving twice -> 409') : bad(`approve twice: ${twice}`);
      (await post('/signup/school/claim-requests', { claimId, fullName: 'Late', email: 'late@x.test' })).status === 409 ? ok('request for a claimed placeholder -> 409') : bad('claimed placeholder accepted a request');

      console.log('\n--- [#4] Creator LOSES edit rights once claimed ---');
      const edit2 = await patch(`/placeholders/school/${claimId}`, { address: 'too late' }, bearer(creatorTok));
      edit2.status === 403 ? ok('creator edit after claim -> 403 (rights revoked)') : bad(`creator still editable after claim: ${edit2.status}`);
      const stillAddr = (await pool.query('SELECT address FROM schools WHERE id=$1', [claimId])).rows[0].address;
      stillAddr === '99 New Rd' ? ok('post-claim edit did not mutate the record') : bad(`address changed to: ${stillAddr}`);

      console.log('\n--- Approved admin operates after choosing a password ---');
      const first = await j(await post('/auth/login', { email: 'head@willow.edu', password: approved.temporaryPassword }));
      first.user?.must_change_password === true ? ok('first login must change the temporary password') : bad(`first login: ${JSON.stringify(first)}`);
      const changed = await j(await post('/auth/change-password', { currentPassword: approved.temporaryPassword, newPassword: 'Willow123!x' }, bearer(first.token)));
      const nowOk = await get('/t/students', bearer(changed.token));
      nowOk.status === 200 ? ok('after the change, data route allowed (200)') : bad(`still blocked: ${nowOk.status}`);

      console.log('\n--- Fresh signup (no claim) -> operational immediately ---');
      // acceptLegal: the Terms / Privacy checkbox (account-settings), versions from client/src/legal.
      const freshBase = { orgName: '3 Bees Transport', address: '1 Main St', zip: '02139', state: 'MA', fullName: 'Owner', password: PW, acceptLegal: LEGAL };
      const fresh = await post('/signup/company', { ...freshBase, email: 'owner@3bees.com' });
      const freshBody = await j(fresh);
      (fresh.status === 201 && freshBody.mode === 'created' && freshBody.token) ? ok('fresh signup -> 201 created + token (operational)') : bad(`fresh signup wrong: ${fresh.status} ${JSON.stringify(freshBody)}`);
      (await post('/signup/company', { orgName: 'Dup', address: '1 Main St', zip: '02139', state: 'MA', fullName: 'x', email: 'owner@3bees.com', password: PW, acceptLegal: LEGAL })).status === 409 ? ok('duplicate email -> 409') : bad('duplicate email allowed');

      console.log('\n--- Fresh signup: address/zip/state now required ---');
      (await post('/signup/company', { ...freshBase, address: undefined, email: 'noaddr@3bees.com' })).status === 400
        ? ok('missing address -> 400') : bad('missing address accepted');
      (await post('/signup/company', { ...freshBase, zip: undefined, email: 'nozip@3bees.com' })).status === 400
        ? ok('missing zip -> 400') : bad('missing zip accepted');
      (await post('/signup/company', { ...freshBase, state: undefined, email: 'nostate@3bees.com' })).status === 400
        ? ok('missing state -> 400' ) : bad('missing state accepted');
      (await post('/signup/company', { ...freshBase, zip: 'abc', email: 'badzip@3bees.com' })).status === 400
        ? ok('invalid zip format -> 400') : bad('invalid zip accepted');
      (await post('/signup/company', { ...freshBase, state: 'ZZ', email: 'badstate@3bees.com' })).status === 400
        ? ok('invalid state code -> 400') : bad('invalid state accepted');

      console.log('\n--- Fresh signup: lowercase state code normalized to uppercase ---');
      const lower = await post('/signup/company', { ...freshBase, state: 'ma', email: 'lowerstate@3bees.com' });
      const lowerBody = await j(lower);
      lower.status === 201 ? ok('lowercase state code accepted -> 201') : bad(`lowercase state rejected: ${lower.status}`);
      const storedState = (await pool.query('SELECT state FROM companies WHERE created_by_user_id IS NULL AND name=$1 ORDER BY created_at DESC LIMIT 1', ['3 Bees Transport'])).rows[0]?.state;
      storedState === 'MA' ? ok('state normalized to uppercase in DB') : bad(`state stored as: ${storedState}`);

      console.log('\n--- Fresh signup: password complexity enforced ---');
      (await post('/signup/company', { ...freshBase, password: 'alllower1!', email: 'noupper@3bees.com' })).status === 400
        ? ok('password missing uppercase -> 400') : bad('password missing uppercase accepted');
      (await post('/signup/company', { ...freshBase, password: 'ALLUPPER1!', email: 'nolower@3bees.com' })).status === 400
        ? ok('password missing lowercase -> 400') : bad('password missing lowercase accepted');
      (await post('/signup/company', { ...freshBase, password: 'NoSpecial1', email: 'nospecial@3bees.com' })).status === 400
        ? ok('password missing special character -> 400') : bad('password missing special character accepted');
      (await post('/signup/company', { ...freshBase, password: 'Sh0rt!', email: 'tooshort@3bees.com' })).status === 400
        ? ok('password too short -> 400') : bad('short password accepted');
      (await post('/signup/company', { ...freshBase, email: 'goodpw@3bees.com' })).status === 201
        ? ok('valid complex password -> 201') : bad('valid complex password rejected');

      console.log('\n--- Claimed placeholder no longer appears in search ---');
      const search2 = await j(await get('/signup/school/claimable?name=willow%20creek%20elem'));
      (search2.candidates?.length === 0) ? ok('claimed placeholder excluded from claimable search') : bad('claimed placeholder still searchable');

      console.log('\n--- A self-claim started before the fix never gains access ---');
      // State left behind by the old flow: placeholder pending_claim, unverified claimant attached,
      // a live verification token in their inbox.
      const p2 = (await pool.query(
        "INSERT INTO schools(name,address,claim_status,claim_expires_at,created_by_user_id) VALUES('Maple Ridge School','5 Elm St','pending_claim',now() + interval '1 day',$1) RETURNING id",
        [creatorUser.id]
      )).rows[0];
      const legacy = (await pool.query(
        "INSERT INTO users(email,password_hash,full_name,role,school_id) VALUES('a@maple.edu',$1,'Claimant A','school_admin',$2) RETURNING id",
        [pwHash, p2.id]
      )).rows[0];
      await pool.query('UPDATE schools SET claimed_by_user_id=$1 WHERE id=$2', [legacy.id, p2.id]);
      const legacyToken = 'ab'.repeat(32);
      await pool.query("INSERT INTO email_verification_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now() + interval '1 day')", [legacy.id, hashToken(legacyToken)]);
      const legacyVer = await j(await post('/auth/verify-email', { token: legacyToken }));
      (legacyVer.verified === true && legacyVer.claimFinalized === false) ? ok('verify-email no longer finalizes a claim') : bad(`verify: ${JSON.stringify(legacyVer)}`);
      (await pool.query('SELECT claim_status FROM schools WHERE id=$1', [p2.id])).rows[0].claim_status === 'pending_claim' ? ok('the placeholder is not claimed') : bad('placeholder got claimed');
      const aTok = (await j(await post('/auth/login', { email: 'a@maple.edu', password: PW }))).token;
      (await get('/t/students', bearer(aTok))).status === 403 ? ok('the old claimant is refused data (403)') : bad('old claimant reached data');
      const pending = (await j(await get('/signup/school/claimable?name=maple%20ridge'))).candidates ?? [];
      pending.some((c) => c.id === p2.id) ? ok('the placeholder can still be requested') : bad('placeholder not requestable');
      await post('/signup/school/claim-requests', { claimId: p2.id, fullName: 'Real Principal', email: 'principal@maple.edu' });
      const realReq = (await pool.query("SELECT id FROM placeholder_claim_requests WHERE requester_email='principal@maple.edu'")).rows[0];
      await approveClaimRequest(realReq.id, { decidedBy: 'Test Owner' });
      (await pool.query("SELECT is_active FROM users WHERE email='a@maple.edu'")).rows[0].is_active === false
        ? ok('approving the real request deactivates the old claimant') : bad('old claimant still active');
      (await post('/auth/login', { email: 'a@maple.edu', password: PW })).status === 401 ? ok('old claimant cannot log in (401)') : bad('old claimant can log in');

      console.log('\n--- Owner script (server/scripts/claim-requests.js) ---');
      const { spawnSync } = require('node:child_process');
      const path = require('node:path');
      const script = (...args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'claim-requests.js'), ...args], {
        env: { ...process.env }, encoding: 'utf8',
      });
      const p3 = (await pool.query("INSERT INTO schools(name,address,claim_status,created_by_user_id) VALUES('Birch Lane School','9 Birch Ln','unclaimed',$1) RETURNING id", [creatorUser.id])).rows[0];
      await post('/signup/school/claim-requests', { claimId: p3.id, fullName: 'Pat Principal', email: 'pat@birch.edu' });
      await post('/signup/school/claim-requests', { claimId: p3.id, fullName: 'Someone Else', email: 'else@birch.edu' });
      const [r1, r2] = (await pool.query("SELECT id, requester_email FROM placeholder_claim_requests WHERE org_id=$1 ORDER BY requester_email DESC", [p3.id])).rows;
      const listed = script('list');
      (listed.status === 0 && listed.stdout.includes('Birch Lane School') && listed.stdout.includes('pat@birch.edu')) ? ok('script lists pending requests with the school and requester') : bad(`list: ${listed.status} ${listed.stdout}${listed.stderr}`);
      const dry = script('approve', r1.id, '--by', 'Owner');
      (dry.status === 1 && /Dry run/.test(dry.stdout)) ? ok('approve without --yes is a dry run') : bad(`dry: ${dry.stdout}`);
      (await pool.query('SELECT claim_status FROM schools WHERE id=$1', [p3.id])).rows[0].claim_status === 'unclaimed' ? ok('dry run changed nothing') : bad('dry run changed the school');
      const rej = script('reject', r2.id, '--by', 'Owner', '--note', 'not staff', '--yes');
      (rej.status === 0 && (await pool.query('SELECT status FROM placeholder_claim_requests WHERE id=$1', [r2.id])).rows[0].status === 'rejected') ? ok('script rejects a request') : bad(`reject: ${rej.stdout}${rej.stderr}`);
      const appr = script('approve', r1.id, '--by', 'Owner', '--yes');
      const shownPw = /Temporary password[^:]*: (\S+)/.exec(appr.stdout)?.[1];
      (appr.status === 0 && shownPw && (await post('/auth/login', { email: 'pat@birch.edu', password: shownPw })).status === 200)
        ? ok('script approves, prints the temporary password once, and it signs in') : bad(`approve: ${appr.stdout}${appr.stderr}`);
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
