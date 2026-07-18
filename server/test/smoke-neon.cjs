// Neon smoke check — NOT part of `npm test` (it hits the real shared dev database).
// Confirms all migrations are recorded on Neon and that a real signup -> login -> /auth/me
// round-trip works against it. Cleans up the rows it creates afterward.
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { Client } = require('pg');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { createRecorder } = require('./lib/testkit.cjs');

const rec = createRecorder('neon-smoke');
const { ok, bad } = rec;

async function main() {
  if (!/neon\.tech/.test(process.env.DATABASE_URL || '')) {
    console.error('DATABASE_URL does not look like a Neon connection string — aborting to avoid running against the wrong DB.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const migCount = (await client.query('SELECT count(*)::int AS n FROM pgmigrations')).rows[0].n;
  migCount === 8 ? ok(`pgmigrations recorded ${migCount}/8 migrations on Neon`) : bad(`pgmigrations has ${migCount}, expected 8`);
  await client.end();

  const app = createApp();
  const server = app.listen(0); // ephemeral local port; still talks to Neon over the network
  const { port } = server.address();
  const BASE = `http://localhost:${port}`;
  let createdUserId = null;
  let createdCompanyId = null;

  try {
    const health = await fetch(`${BASE}/health`);
    health.status === 200 ? ok('GET /health -> 200 (Neon-backed server up)') : bad(`health status ${health.status}`);

    const email = `smoke-test-${Date.now()}@saferoute.test`;
    const signup = await fetch(`${BASE}/signup/company`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgName: 'Neon Smoke Co', fullName: 'Smoke Test', email, password: 'Secret123!' }),
    });
    const signupBody = await signup.json();
    (signup.status === 201 && signupBody.token) ? ok('POST /signup/company -> 201 + token (against Neon)') : bad(`signup ${signup.status} ${JSON.stringify(signupBody)}`);
    createdUserId = signupBody.user?.id;

    const login = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Secret123!' }),
    });
    const loginBody = await login.json();
    (login.status === 200 && loginBody.token) ? ok('POST /auth/login -> 200 + token (against Neon)') : bad(`login ${login.status}`);

    const me = await fetch(`${BASE}/auth/me`, { headers: { authorization: `Bearer ${loginBody.token}` } });
    me.status === 200 ? ok('GET /auth/me -> 200 (against Neon)') : bad(`me ${me.status}`);

    if (createdUserId) {
      const row = (await pool.query('SELECT company_id FROM users WHERE id = $1', [createdUserId])).rows[0];
      createdCompanyId = row?.company_id;
    }
  } finally {
    server.close();
    // Leave the shared dev DB clean.
    if (createdUserId) await pool.query('DELETE FROM users WHERE id = $1', [createdUserId]).catch(() => {});
    if (createdCompanyId) await pool.query('DELETE FROM companies WHERE id = $1', [createdCompanyId]).catch(() => {});
    await pool.end();
  }

  const { fail } = rec.summarize();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
