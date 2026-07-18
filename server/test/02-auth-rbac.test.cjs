// Step 2 — JWT auth + RBAC + tenant-scoping middleware, exercised over real HTTP against
// the real Express app and an isolated embedded PostgreSQL.
const PG_PORT = 5451;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-02';
process.env.JWT_EXPIRES_IN = '12h';

const express = require('express');
const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const authenticate = require('../src/middleware/authenticate.js');
const attachScopedDb = require('../src/middleware/tenant.js');
const { requireRole, ownerScope } = require('../src/middleware/authorize.js');
const authRoutes = require('../src/routes/auth.js');
const { createScopedDb, ScopeError } = require('../src/db/scoped.js');

const rec = createRecorder('02-auth-rbac');
const { ok, bad } = rec;
const BASE = 'http://localhost:4200';
const PW = 'Secret123!';

async function login(email, password = PW) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const authHdr = (t) => ({ authorization: `Bearer ${t}` });

async function main() {
  const epg = await startEmbeddedPostgres('02-auth-rbac', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const q = (sql, p) => pool.query(sql, p).then((r) => r.rows[0]);
    const A = await q("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Company A','claimed',now()) RETURNING id");
    const B = await q("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Company B','claimed',now()) RETURNING id");
    const S = await q("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    await q("INSERT INTO users(email,password_hash,full_name,role,company_id) VALUES('adminA@x.com',$1,'Admin A','company_admin',$2) RETURNING id", [hash, A.id]);
    const driverA = await q("INSERT INTO users(email,password_hash,full_name,role,company_id) VALUES('driverA@x.com',$1,'Driver A','driver',$2) RETURNING id", [hash, A.id]);
    await q("INSERT INTO users(email,password_hash,full_name,role,company_id) VALUES('adminB@x.com',$1,'Admin B','company_admin',$2) RETURNING id", [hash, B.id]);
    await q("INSERT INTO users(email,password_hash,full_name,role,school_id) VALUES('schooladmin@x.com',$1,'School Admin','school_admin',$2) RETURNING id", [hash, S.id]);
    await q("INSERT INTO users(email,password_hash,full_name,role,company_id,is_active) VALUES('inactive@x.com',$1,'Inactive','company_admin',$2,false) RETURNING id", [hash, A.id]);
    const vanA = await q("INSERT INTO vans(company_id,license_plate,model) VALUES($1,'AAA-111','Transit') RETURNING id", [A.id]);
    const vanB = await q("INSERT INTO vans(company_id,license_plate,model) VALUES($1,'BBB-222','Sprinter') RETURNING id", [B.id]);

    const app = express();
    app.use(express.json());
    app.use('/auth', authRoutes);
    app.get('/t/vans', authenticate, attachScopedDb, async (req, res, next) => {
      try { res.json(await req.db.findMany('vans', { orderBy: 'license_plate' })); } catch (e) { next(e); }
    });
    app.get('/t/sessions', authenticate, attachScopedDb, async (req, res, next) => {
      try { res.json(await req.db.findMany('sessions')); } catch (e) { next(e); }
    });
    app.get('/t/admin-only', authenticate, requireRole('company_admin'), (req, res) => res.json({ ok: true }));
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
    const server = app.listen(4200);

    try {
      console.log('--- Auth ---');
      (await login('adminA@x.com', 'wrong')).status === 401 ? ok('wrong password -> 401') : bad('wrong password not 401');
      (await login('nobody@x.com')).status === 401 ? ok('unknown user -> 401') : bad('unknown user not 401');
      (await login('inactive@x.com')).status === 401 ? ok('inactive user login -> 401') : bad('inactive login not 401');

      const la = await login('adminA@x.com');
      la.status === 200 && la.body.token ? ok('valid login -> 200 + token') : bad('valid login failed');
      const tokenA = la.body.token;
      (la.body.user.role === 'company_admin' && la.body.user.tenantId === A.id) ? ok('login returns correct role + tenant') : bad('login identity wrong');

      const tokenDriverA = (await login('driverA@x.com')).body.token;
      const tokenAdminB = (await login('adminB@x.com')).body.token;
      const tokenSchool = (await login('schooladmin@x.com')).body.token;

      const me = await fetch(`${BASE}/auth/me`, { headers: authHdr(tokenA) });
      (me.status === 200 && (await me.json()).user.userId) ? ok('/auth/me with token -> identity') : bad('/auth/me failed');
      (await fetch(`${BASE}/auth/me`)).status === 401 ? ok('/auth/me without token -> 401') : bad('/auth/me open without token');
      (await fetch(`${BASE}/auth/me`, { headers: authHdr(tokenA + 'x') })).status === 401 ? ok('tampered token -> 401') : bad('tampered token accepted');

      console.log('\n--- Tenant isolation (HTTP, via scoped req.db) ---');
      const vansA = await (await fetch(`${BASE}/t/vans`, { headers: authHdr(tokenA) })).json();
      (vansA.length === 1 && vansA[0].id === vanA.id) ? ok('admin A sees only Company A van') : bad(`admin A vans wrong: ${JSON.stringify(vansA.map((v) => v.license_plate))}`);
      const vansB = await (await fetch(`${BASE}/t/vans`, { headers: authHdr(tokenAdminB) })).json();
      (vansB.length === 1 && vansB[0].id === vanB.id) ? ok('admin B sees only Company B van') : bad('admin B vans wrong');

      console.log('\n--- RBAC role gate + structural scope ---');
      (await fetch(`${BASE}/t/admin-only`, { headers: authHdr(tokenDriverA) })).status === 403 ? ok('driver hitting admin-only -> 403') : bad('driver reached admin-only');
      (await fetch(`${BASE}/t/admin-only`, { headers: authHdr(tokenA) })).status === 200 ? ok('company_admin hitting admin-only -> 200') : bad('admin blocked from admin-only');
      (await fetch(`${BASE}/t/sessions`, { headers: authHdr(tokenSchool) })).status === 403 ? ok('school user reaching company-only table (sessions) -> 403') : bad('school user reached sessions');

      console.log('\n--- Scoped accessor (unit) ---');
      const dbA = createScopedDb(pool, { type: 'company', id: A.id }, { userId: driverA.id, role: 'company_admin' });
      (await dbA.findById('vans', vanB.id)) === null ? ok('findById across tenants -> null (no existence leak)') : bad('cross-tenant findById leaked');
      const ins = await dbA.insert('vans', { license_plate: 'NEW-999', model: 'Test' });
      ins.company_id === A.id ? ok('insert auto-stamps caller tenant (company_id)') : bad('insert did not stamp tenant');
      try {
        const dbS = createScopedDb(pool, { type: 'school', id: S.id }, { userId: 'x', role: 'school_admin' });
        await dbS.findMany('sessions');
        bad('school accessor allowed sessions');
      } catch (e) {
        e instanceof ScopeError ? ok('school accessor rejects company-only table') : bad(`unexpected error: ${e.message}`);
      }
      const dbDriver = createScopedDb(pool, { type: 'company', id: A.id }, { userId: driverA.id, role: 'driver' });
      const own = await dbDriver.findMany('sessions', { owner: ownerScope({ auth: { role: 'driver', userId: driverA.id } }, 'sessions') });
      Array.isArray(own) ? ok('driver owner sub-scope query builds + runs') : bad('driver owner sub-scope failed');
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
