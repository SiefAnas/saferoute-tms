// Resend bounce webhook: only requests carrying a valid Svix signature (RESEND_WEBHOOK_SECRET)
// flag a user as bounced. Unsigned, wrongly signed, tampered or replayed (timestamp more than
// 5 minutes off) requests are refused and write nothing. Off (404) when the secret is unset.
const crypto = require('crypto');
const PG_PORT = 5478;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-28';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('28-resend-webhook');
const { eq } = rec;
const BASE = 'http://localhost:5985';
const KEY = crypto.randomBytes(24);
const SECRET = `whsec_${KEY.toString('base64')}`;

// An independent Svix signer (the documented scheme), so the test doesn't reuse the code under test.
function sign(body, { key = KEY, id = 'msg_1', timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const sig = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${sig}` };
}
async function post(body, headers = {}) {
  const r = await fetch(`${BASE}/webhooks/email-bounce`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: data };
}
const bounced = async (email) => (await pool.query('SELECT email_bounced FROM users WHERE email = $1', [email])).rows[0].email_bounced;

async function main() {
  const epg = await startEmbeddedPostgres('28-resend-webhook', PG_PORT);
  try {
    runMigrateUp();
    const A = (await pool.query("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id")).rows[0].id;
    const hash = await hashPassword('Secret123!');
    for (const email of ['one@a.test', 'two@a.test', 'three@a.test']) {
      await pool.query("INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES($1,$2,'X','driver',$3,now())", [email, hash, A]);
    }
    const event = (to, type = 'email.bounced') => JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: 'e1', to } });

    const app = createApp();
    const server = app.listen(5985);
    try {
      console.log('--- not configured ---');
      delete process.env.RESEND_WEBHOOK_SECRET;
      const off = event(['one@a.test']);
      eq('secret unset -> 404, even with a signature', (await post(off, sign(off))).status, 404);
      eq('nothing flagged', await bounced('one@a.test'), false);

      process.env.RESEND_WEBHOOK_SECRET = SECRET;
      console.log('\n--- refused ---');
      const body = event(['one@a.test']);
      eq('no signature headers -> 401', (await post(body)).status, 401);
      eq('the old x-webhook-secret header no longer works -> 401', (await post(body, { 'x-webhook-secret': SECRET })).status, 401);
      eq('signed with another key -> 401', (await post(body, sign(body, { key: crypto.randomBytes(24) }))).status, 401);
      const signed = sign(body);
      eq('body changed after signing -> 401', (await post(event(['two@a.test']), signed)).status, 401);
      eq('svix-id changed after signing -> 401', (await post(body, { ...signed, 'svix-id': 'msg_other' })).status, 401);
      eq('timestamp 6 minutes old -> 401 (replay)', (await post(body, sign(body, { timestamp: Math.floor(Date.now() / 1000) - 360 }))).status, 401);
      eq('timestamp 6 minutes ahead -> 401', (await post(body, sign(body, { timestamp: Math.floor(Date.now() / 1000) + 360 }))).status, 401);
      eq('unknown signature version -> 401', (await post(body, { ...signed, 'svix-signature': signed['svix-signature'].replace('v1,', 'v2,') })).status, 401);
      eq('none of the refused requests flagged anyone', `${await bounced('one@a.test')} ${await bounced('two@a.test')}`, 'false false');

      console.log('\n--- accepted ---');
      const ok1 = await post(body, sign(body));
      eq('valid signature -> 200, one user flagged', `${ok1.status} ${ok1.body?.flagged}`, '200 1');
      eq('the recipient is flagged', await bounced('one@a.test'), true);
      const rotated = event(['TWO@a.test', 'nobody@x.test']);
      const good = sign(rotated);
      const bad = sign(rotated, { key: crypto.randomBytes(24) });
      const both = { ...good, 'svix-signature': `${bad['svix-signature']} ${good['svix-signature']}` };
      eq('several signatures (key rotation): one valid is enough; email match ignores case', (await post(rotated, both)).body?.flagged, 1);
      const delivered = event(['three@a.test'], 'email.delivered');
      const other = await post(delivered, sign(delivered));
      eq('other event types are acknowledged and change nothing', `${other.status} ${other.body?.flagged} ${await bounced('three@a.test')}`, '200 0 false');
      const notJson = 'not json';
      eq('a signed body that is not JSON -> 400', (await post(notJson, sign(notJson))).status, 400);
      eq('the same bounce again is harmless', (await post(body, sign(body, { id: 'msg_2' }))).body?.flagged, 0);

      console.log('\n--- the rest of the API still parses JSON ---');
      const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'one@a.test', password: 'wrong' }) });
      eq('POST /auth/login still reads its JSON body (401 bad credentials, not 400)', login.status, 401);
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
