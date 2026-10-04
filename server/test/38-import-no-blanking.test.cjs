// Bulk import updates never write a field the import type doesn't have (branch
// prod-safety-and-import-fix). Before the fix, execPerson always sent full_name, phone, address
// and license_number; for a type without one of those the value was undefined, updateFields only
// skipped '', and node-postgres wrote undefined as NULL: importing school staff wiped their
// address, importing monitors / parents wiped license_number. Also: a blank cell still leaves the
// old value alone, and a filled cell still overwrites.
const PG_PORT = 5496;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-38';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const rec = createRecorder('38-import-no-blanking');
const { eq } = rec;
const BASE = 'http://localhost:5996';
const PW = 'Secret123!';

async function api(method, p, token, body) {
  const opts = { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const r = await fetch(BASE + p, opts);
  return { status: r.status, body: await r.json() };
}
const login = (email) => fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }),
}).then((r) => r.json()).then((b) => b.token);

async function main() {
  const epg = await startEmbeddedPostgres('38-import-no-blanking', PG_PORT);
  try {
    runMigrateUp();
    const hash = await hashPassword(PW);
    const q = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await q("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const S = await q("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const admin = await q(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('admin@a.test',$1,'Admin','company_admin',$2,now()) RETURNING id", [hash, A.id]);
    const sAdmin = await q(
      "INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('sadmin@s.test',$1,'School Admin','school_admin',$2,now()) RETURNING id", [hash, S.id]);
    // Existing people, each created by the admin who will import over them (creator-only rule).
    const person = (email, role, col, tenant, creator, f) => q(
      `INSERT INTO users(email,password_hash,full_name,role,${col},email_verified_at,created_by_user_id,phone,address,license_number)
       VALUES($1,$2,$3,$4,$5,now(),$6,$7,$8,$9) RETURNING id`,
      [email, hash, f.full_name, role, tenant, creator, f.phone ?? null, f.address ?? null, f.license_number ?? null]
    );
    const staff = await person('staff@s.test', 'school_staff', 'school_id', S.id, sAdmin.id, { full_name: 'Sam Staff', phone: '555-0001', address: '1 School Rd' });
    const monitor = await person('mon@a.test', 'monitor', 'company_id', A.id, admin.id, { full_name: 'Mo Monitor', phone: '555-0002', address: '2 Van St', license_number: 'MON-123' });
    const parent = await person('par@a.test', 'parent', 'company_id', A.id, admin.id, { full_name: 'Pat Parent', phone: '555-0003', address: '3 Home Ave', license_number: 'PAR-456' });
    const driver = await person('drv@a.test', 'driver', 'company_id', A.id, admin.id, { full_name: 'Dee Driver', phone: '555-0004', address: '4 Road Ln', license_number: 'DRV-789' });
    const read = (id) => q('SELECT full_name, phone, address, license_number FROM users WHERE id = $1', [id]);

    const server = createApp().listen(5996);
    try {
      const tA = await login('admin@a.test');
      const tS = await login('sadmin@s.test');
      const commit = async (token, type, rows) => {
        const r = await api('POST', '/imports/commit', token, { type, rows });
        eq(`  (${type} commit -> 200, ${rows.length} updated)`, `${r.status} ${r.body.counts?.updated}`, `200 ${rows.length}`);
      };

      console.log('--- school staff: the file has no address column ---');
      await commit(tS, 'staff', [{ email: 'staff@s.test', full_name: 'Samantha Staff', phone: '555-1001' }]);
      let s = await read(staff.id);
      eq('staff address unchanged (the staff type has no address field)', s.address, '1 School Rd');
      eq('staff license_number unchanged (still NULL, never written)', s.license_number, null);
      eq('filled cells overwrite: full_name', s.full_name, 'Samantha Staff');
      eq('filled cells overwrite: phone', s.phone, '555-1001');
      await commit(tS, 'staff', [{ email: 'staff@s.test', full_name: '', phone: '' }]);
      s = await read(staff.id);
      eq('blank cells leave the old values alone (name, phone)', `${s.full_name}|${s.phone}`, 'Samantha Staff|555-1001');
      eq('...and the address is still there', s.address, '1 School Rd');

      console.log('\n--- monitor: the file has no license_number column ---');
      await commit(tA, 'monitors', [{ email: 'mon@a.test', full_name: 'Moe Monitor', phone: '', address: '' }]);
      let m = await read(monitor.id);
      eq('monitor license_number unchanged (the monitors type has no such field)', m.license_number, 'MON-123');
      eq('blank address cell leaves the address alone', m.address, '2 Van St');
      eq('blank phone cell leaves the phone alone', m.phone, '555-0002');
      eq('filled full_name overwrites', m.full_name, 'Moe Monitor');
      await commit(tA, 'monitors', [{ email: 'mon@a.test', address: '22 New Van St' }]);
      m = await read(monitor.id);
      eq('filled address overwrites; license_number still unchanged', `${m.address}|${m.license_number}`, '22 New Van St|MON-123');

      console.log('\n--- parent: the file has no license_number column ---');
      await commit(tA, 'parents', [{ email: 'par@a.test', full_name: 'Patricia Parent', phone: '555-3003', address: '33 Home Ave' }]);
      const p = await read(parent.id);
      eq('parent license_number unchanged', p.license_number, 'PAR-456');
      eq('parent filled cells overwrite', `${p.full_name}|${p.phone}|${p.address}`, 'Patricia Parent|555-3003|33 Home Ave');

      console.log('\n--- driver: the type HAS license_number ---');
      await commit(tA, 'drivers', [{ email: 'drv@a.test', license_number: '' }]);
      eq('blank license cell leaves it alone', (await read(driver.id)).license_number, 'DRV-789');
      await commit(tA, 'drivers', [{ email: 'drv@a.test', license_number: 'DRV-000' }]);
      const d = await read(driver.id);
      eq('filled license cell overwrites', d.license_number, 'DRV-000');
      eq('...and nothing else moved', `${d.full_name}|${d.phone}|${d.address}`, 'Dee Driver|555-0004|4 Road Ln');

      console.log('\n--- keys outside the type are ignored, even if the file sends them ---');
      await commit(tS, 'staff', [{ email: 'staff@s.test', address: 'HACKED', license_number: 'X', role: 'school_admin' }]);
      s = await read(staff.id);
      eq('staff address and license untouched by keys the staff type does not have', `${s.address}|${s.license_number}`, '1 School Rd|null');
      eq('role untouched', (await q('SELECT role FROM users WHERE id = $1', [staff.id])).role, 'school_staff');
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
