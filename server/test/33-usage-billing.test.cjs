// Usage + billing, read only (branch account-settings): GET /companies/me/usage and
// /companies/me/billing (company_admin only, own company only), and
// scripts/snapshot-usage.js (one row per company per day, idempotent, --dry-run writes nothing).
const PG_PORT = 5491;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-33';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const { snapshotUsage } = require('../scripts/snapshot-usage.js');

const rec = createRecorder('33-usage-billing');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5992';
const PW = 'Secret123!';

async function api(method, p, token) {
  const r = await fetch(BASE + p, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: data };
}
const login = (email) => fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }),
}).then((r) => r.json()).then((b) => b.token);

async function main() {
  const epg = await startEmbeddedPostgres('33-usage-billing', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const q = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await q("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const B = await q("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co B','claimed',now()) RETURNING id");
    await q("INSERT INTO companies(name,claim_status) VALUES('Placeholder Co','unclaimed') RETURNING id");
    const S1 = await q("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School 1','claimed',now()) RETURNING id");
    const S2 = await q("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School 2','claimed',now()) RETURNING id");
    await q("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School 3','claimed',now()) RETURNING id");
    const user = (email, role, col, id, active = true) => q(
      `INSERT INTO users(email,password_hash,full_name,role,${col},email_verified_at,is_active) VALUES($1,$2,$1,$3,$4,now(),$5) RETURNING id`,
      [email, hash, role, id, active]
    );
    const adminA = await user('admin@a.com', 'company_admin', 'company_id', A.id);
    await user('admin@b.com', 'company_admin', 'company_id', B.id);
    for (const e of ['d1@a.com', 'd2@a.com', 'd3@a.com']) await user(e, 'driver', 'company_id', A.id);
    await user('gone@a.com', 'driver', 'company_id', A.id, false);
    await user('m1@a.com', 'monitor', 'company_id', A.id);
    await user('p1@a.com', 'parent', 'company_id', A.id);
    await user('db@b.com', 'driver', 'company_id', B.id);
    await user('sa@s.com', 'school_admin', 'school_id', S1.id);
    for (let i = 0; i < 4; i++) await q('INSERT INTO students(company_id,school_id,full_name,grade) VALUES($1,$2,$3,\'3\')', [A.id, i < 3 ? S1.id : S2.id, `Kid ${i}`]);
    await q("INSERT INTO students(company_id,school_id,full_name,grade) VALUES($1,$2,'B Kid','3')", [B.id, S1.id]);
    await q("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'AAA-111','Ford','Transit',2022)", [A.id]);
    await q("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'AAA-222','Ford','Transit',2022)", [A.id]);
    await q("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'BBB-111','Ford','Transit',2022)", [B.id]);
    // A placeholder school company A created and has no students at yet still counts (GET /schools rule).
    await q("INSERT INTO schools(name,claim_status,created_by_user_id) VALUES('Placeholder School','unclaimed',$1)", [adminA.id]);

    const server = createApp().listen(5992);
    try {
      const tA = await login('admin@a.com');
      const tB = await login('admin@b.com');
      const want = { students: 4, drivers: 3, monitors: 1, vans: 2, schools: 3 };

      console.log('--- GET /companies/me/usage ---');
      const u = await api('GET', '/companies/me/usage', tA);
      eq('company A usage', JSON.stringify(u.body), JSON.stringify(want));
      ok('  (deactivated driver, parents, other company rows and unrelated schools not counted)');
      eq('company B sees only its own', JSON.stringify((await api('GET', '/companies/me/usage', tB)).body), JSON.stringify({ students: 1, drivers: 1, monitors: 0, vans: 1, schools: 1 }));
      const schoolsList = (await api('GET', '/schools', tA)).body;
      eq('schools count matches GET /schools for the same company', u.body.schools, schoolsList.length);
      for (const [email, label] of [['d1@a.com', 'driver'], ['m1@a.com', 'monitor'], ['p1@a.com', 'parent'], ['sa@s.com', 'school_admin']]) {
        const t = await login(email);
        eq(`${label}: usage -> 403`, (await api('GET', '/companies/me/usage', t)).status, 403);
        eq(`${label}: billing -> 403`, (await api('GET', '/companies/me/billing', t)).status, 403);
      }
      eq('no token -> 401', (await api('GET', '/companies/me/usage')).status, 401);

      console.log('\n--- GET /companies/me/billing ---');
      const b = await api('GET', '/companies/me/billing', tA);
      (b.status === 200 && b.body.plan === 'pilot' && b.body.status === 'free' && b.body.trial_ends_at === null && JSON.stringify(b.body.usage) === JSON.stringify(want))
        ? ok('billing -> pilot / free / no trial date + the same usage counts') : bad(`billing: ${b.status} ${JSON.stringify(b.body)}`);
      eq('billing has nothing payment-like', Object.keys(b.body).sort().join(','), 'plan,status,trial_ends_at,usage');

      console.log('\n--- scripts/snapshot-usage.js ---');
      const quiet = () => {};
      const count = async () => (await pool.query('SELECT count(*)::int AS n FROM usage_snapshots')).rows[0].n;
      const dry = await snapshotUsage({ dryRun: true, log: quiet });
      eq('dry run reports the 2 claimed companies (not the placeholder)', dry.results.length, 2);
      eq('dry run writes nothing', await count(), 0);
      await snapshotUsage({ log: quiet });
      eq('real run: one row per claimed company', await count(), 2);
      const rowA = await q('SELECT students, drivers, monitors, vans, schools, captured_on = CURRENT_DATE AS today FROM usage_snapshots WHERE company_id = $1', [A.id]);
      eq('company A snapshot matches the endpoint', JSON.stringify({ students: rowA.students, drivers: rowA.drivers, monitors: rowA.monitors, vans: rowA.vans, schools: rowA.schools }), JSON.stringify(want));
      eq('captured_on is the database\'s today', rowA.today, true);
      await snapshotUsage({ log: quiet });
      eq('second run the same day: still one row per company', await count(), 2);
      await q("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'AAA-333','Ford','Transit',2022)", [A.id]);
      await snapshotUsage({ log: quiet });
      eq('a re-run updates today\'s row to the current numbers', (await q('SELECT vans FROM usage_snapshots WHERE company_id = $1', [A.id])).vans, 3);
      eq('...without adding a row', await count(), 2);
      await pool.query("UPDATE usage_snapshots SET captured_on = captured_on - 1");
      await snapshotUsage({ log: quiet });
      eq('the next day adds new rows and keeps yesterday\'s', await count(), 4);
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
