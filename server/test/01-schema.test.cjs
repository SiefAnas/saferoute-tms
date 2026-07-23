// Step 1 — schema + migrations, applied via the REAL `npm run migrate:up` CLI against a
// real (embedded) PostgreSQL, then exercised with positive/negative multi-tenancy tests.
const PG_PORT = 5450;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;

const { Client } = require('pg');
const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');

const rec = createRecorder('01-schema');
const { ok, bad, eq } = rec;

async function main() {
  const epg = await startEmbeddedPostgres('01-schema', PG_PORT);
  try {
    console.log('$ npm run migrate:up');
    runMigrateUp({ silent: false });

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const applied = (await client.query('SELECT count(*)::int AS n FROM pgmigrations')).rows[0].n;
      eq('pgmigrations records 10 applied migrations', applied, 10);
      const tables = (await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name<>'pgmigrations' ORDER BY 1"
      )).rows.map((r) => r.table_name);
      console.log('  tables:', tables.join(', '));

      const expectOk = async (label, sql, params) => {
        try { await client.query(sql, params); ok(label); }
        catch (e) { bad(`${label} -> ${e.message}`); }
      };
      const expectReject = async (label, sql, params) => {
        try { await client.query(sql, params); bad(`${label} (allowed but should be rejected)`); }
        catch { ok(`${label} (correctly rejected)`); }
      };

      console.log('\n--- Multi-tenancy guard: users role<->tenant CHECK ---');
      const [c1] = (await client.query("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Acme Co','claimed',now()) RETURNING id")).rows;
      const [c2] = (await client.query("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Other Co','claimed',now()) RETURNING id")).rows;
      const [s1] = (await client.query("INSERT INTO schools(name,claim_status,claimed_at) VALUES('Willow Creek','claimed',now()) RETURNING id")).rows;

      await expectOk('company_admin with company_id',
        "INSERT INTO users(email,password_hash,full_name,role,company_id) VALUES('a@x.com','h','A','company_admin',$1)", [c1.id]);
      await expectOk('school_admin with school_id',
        "INSERT INTO users(email,password_hash,full_name,role,school_id) VALUES('sa@x.com','h','SA','school_admin',$1)", [s1.id]);
      await expectReject('driver with school_id (wrong tenant col)',
        "INSERT INTO users(email,password_hash,full_name,role,school_id) VALUES('bad1@x.com','h','B','driver',$1)", [s1.id]);
      await expectReject('driver with BOTH company_id and school_id',
        "INSERT INTO users(email,password_hash,full_name,role,company_id,school_id) VALUES('bad2@x.com','h','B','driver',$1,$2)", [c1.id, s1.id]);
      await expectReject('driver with NEITHER tenant id',
        "INSERT INTO users(email,password_hash,full_name,role) VALUES('bad3@x.com','h','B','driver')");
      await expectReject('unknown role',
        "INSERT INTO users(email,password_hash,full_name,role,company_id) VALUES('bad4@x.com','h','B','superuser',$1)", [c1.id]);
      await expectReject('duplicate email (case-insensitive)',
        "INSERT INTO users(email,password_hash,full_name,role,company_id) VALUES('A@X.com','h','A2','company_admin',$1)", [c1.id]);

      console.log('\n--- Tenant-consistency composite FKs ---');
      const [driver] = (await client.query("INSERT INTO users(email,password_hash,full_name,role,company_id) VALUES('drv@x.com','h','Drv','driver',$1) RETURNING id", [c1.id])).rows;
      const [stu] = (await client.query("INSERT INTO students(company_id,school_id,full_name,grade) VALUES($1,$2,'Kid A','3') RETURNING id", [c1.id, s1.id])).rows;
      await expectOk('session for driver in same company',
        "INSERT INTO sessions(user_id,company_id) VALUES($1,$2)", [driver.id, c1.id]);
      await expectReject('session with mismatched company_id (cross-tenant)',
        "INSERT INTO sessions(user_id,company_id) VALUES($1,$2)", [driver.id, c2.id]);

      const [sess] = (await client.query('SELECT id FROM sessions WHERE user_id=$1 LIMIT 1', [driver.id])).rows;
      await expectOk('trip w/ consistent company+school vs student',
        "INSERT INTO trips(session_id,company_id,school_id,student_id,trip_type) VALUES($1,$2,$3,$4,'pickup')", [sess.id, c1.id, s1.id, stu.id]);
      await expectReject('trip w/ wrong school_id for that student',
        "INSERT INTO trips(session_id,company_id,school_id,student_id,trip_type) VALUES($1,$2,$3,$4,'pickup')", [sess.id, c1.id, c2.id, stu.id]);
      await expectReject('trip w/ wrong company_id for that student',
        "INSERT INTO trips(session_id,company_id,school_id,student_id,trip_type) VALUES($1,$2,$3,$4,'pickup')", [sess.id, c2.id, s1.id, stu.id]);
      await expectReject('trip w/ bad trip_type',
        "INSERT INTO trips(session_id,company_id,school_id,student_id,trip_type) VALUES($1,$2,$3,$4,'teleport')", [sess.id, c1.id, s1.id, stu.id]);

      console.log('\n--- PayRules: one rate per driver; integer cents ---');
      await expectOk('pay rule hourly $18.50 (1850 cents)',
        "INSERT INTO pay_rules(driver_id,company_id,rate_type,rate_cents) VALUES($1,$2,'hourly',1850)", [driver.id, c1.id]);
      await expectReject('second pay rule for same driver',
        "INSERT INTO pay_rules(driver_id,company_id,rate_type,rate_cents) VALUES($1,$2,'daily',15000)", [driver.id, c1.id]);
      await expectReject('pay rule with bad rate_type',
        "INSERT INTO pay_rules(driver_id,company_id,rate_type,rate_cents) VALUES($1,$2,'weekly',1000)", [c2.id, c2.id]);

      console.log('\n--- updated_at trigger fires on UPDATE ---');
      const before = (await client.query('SELECT updated_at FROM companies WHERE id=$1', [c1.id])).rows[0].updated_at;
      await client.query('SELECT pg_sleep(0.05)');
      await client.query("UPDATE companies SET name='Acme Renamed' WHERE id=$1", [c1.id]);
      const after = (await client.query('SELECT updated_at FROM companies WHERE id=$1', [c1.id])).rows[0].updated_at;
      (new Date(after) > new Date(before)) ? ok('updated_at advanced on UPDATE') : bad('updated_at did not change');
    } finally {
      await client.end();
    }
  } finally {
    await epg.stop();
  }
  const { fail } = rec.summarize();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
