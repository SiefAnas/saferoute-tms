// Company timezone, the edges (branch company-timezone, task 4). Two companies, one in
// America/New_York and one in America/Los_Angeles, share a school. The server clock is pinned
// (time/clock.js) to exact instants and everything goes through the real HTTP API:
//   - same instant, different business dates; 11:30pm local is still "today"
//   - the parent skip cutoff passes at 07:15 LOCAL for a 07:45 pickup, in each zone
//   - a payroll period boundary puts the same instant's session in different days per zone
//   - DST spring forward (2026-03-08) and fall back (2026-11-01) in both zones
//   - changing the DATABASE session timezone changes none of the results (child processes run the
//     same read-only scenario under UTC, UTC+14 and UTC-11 and must answer identically), while a
//     control query that does use the session zone visibly changes.
const PG_PORT = 5486;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-42';
process.env.NODE_ENV = 'test';

const { spawnSync } = require('node:child_process');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const clock = require('../src/time/clock.js');

const API_PORT = 5986;
const BASE = `http://localhost:${API_PORT}`;
const PW = 'Secret123!';
const ZONES = { NY: 'America/New_York', LA: 'America/Los_Angeles' };

async function api(method, p, token, body) {
  const opts = { method, headers: { authorization: `Bearer ${token}` } };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(BASE + p, opts);
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: data };
}

// ---- seed (once, by the parent process) --------------------------------------------------------

async function seed() {
  const { hashPassword } = require('../src/auth/password.js');
  const hash = await hashPassword(PW);
  const q = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
  const school = await q("INSERT INTO schools(name,claim_status,claimed_at) VALUES('Shared School','claimed',now()) RETURNING id");
  await q(`INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('school@s.test',$1,'School Admin','school_admin',$2,now())`, [hash, school.id]);
  for (const [key, zone] of Object.entries(ZONES)) {
    const k = key.toLowerCase();
    const c = await q("INSERT INTO companies(name,claim_status,claimed_at,timezone) VALUES($1,'claimed',now(),$2) RETURNING id", [`${key} Rides`, zone]);
    const user = (email, role, name) => q(
      `INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id`,
      [email, hash, name, role, c.id]
    );
    await user(`admin@${k}.test`, 'company_admin', `${key} Admin`);
    const driver = await user(`driver@${k}.test`, 'driver', `${key} Driver`);
    const parent = await user(`parent@${k}.test`, 'parent', `${key} Parent`);
    const van = await q("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,$2,'Ford','Transit',2022) RETURNING id", [c.id, `${key}-1`]);
    const student = (name) => q("INSERT INTO students(company_id,school_id,full_name,grade) VALUES($1,$2,$3,'3') RETURNING id", [c.id, school.id, `${key} ${name}`]);
    const assign = (s, start, end, pickup = null) => q(
      `INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,end_date,days_of_week,pickup_time)
       VALUES($1,$2,$3,$4,$5,$6,'{1,2,3,4,5,6,7}',$7) RETURNING id`,
      [c.id, s.id, driver.id, van.id, start, end, pickup]
    );
    // One-day rides: who shows up on /schedule/today tells which date the company is on.
    for (const day of ['2026-10-14', '2026-10-15', '2026-03-07', '2026-03-08', '2026-10-31', '2026-11-01']) {
      await assign(await student(`Day ${day}`), day, day);
    }
    // The parent's child: rides every day at 07:45 (skip cutoff 07:15 local).
    const child = await student('Child');
    await assign(child, '2026-01-01', null, '07:45');
    await q('INSERT INTO parent_students(parent_user_id,student_id,company_id) VALUES($1,$2,$3)', [parent.id, child.id, c.id]);
    // Absent-today rows on fixed dates (a separate child so the skip-status checks stay clean).
    const absent = await student('Absent');
    await q("INSERT INTO pickup_skips(company_id,student_id,parent_user_id,skip_date,shift_period) VALUES($1,$2,$3,$4,'morning')",
      [c.id, absent.id, parent.id, key === 'NY' ? '2026-10-15' : '2026-10-14']);
    // Payroll: the same instants for both companies.
    await q("INSERT INTO pay_rules(driver_id,company_id,rate_type,rate_cents) VALUES($1,$2,'hourly',6000)", [driver.id, c.id]);
    for (const [checkIn, minutes] of [
      ['2026-10-01T05:30:00Z', 60], // NY Oct 1 01:30 | LA Sep 30 22:30
      ['2026-03-08T04:59:00Z', 30], // NY Mar 7 23:59 EST | LA Mar 7 20:59 PST
      ['2026-03-08T07:30:00Z', 60], // NY Mar 8 03:30 EDT (after spring forward) | LA Mar 7 23:30 PST
      ['2026-11-01T05:30:00Z', 60], // NY Nov 1 01:30 EDT (first 1:30) | LA Oct 31 22:30 PDT
      ['2026-11-01T06:30:00Z', 60], // NY Nov 1 01:30 EST (second 1:30) | LA Oct 31 23:30 PDT
      ['2026-11-01T08:30:00Z', 60], // NY Nov 1 03:30 EST | LA Nov 1 01:30 PDT (first)
      ['2026-11-01T09:30:00Z', 60], // NY Nov 1 04:30 EST | LA Nov 1 01:30 PST (second)
    ]) {
      await q(`INSERT INTO sessions(user_id,company_id,check_in_at,check_out_at,duration_minutes)
               VALUES($1,$2,$3::timestamptz,$3::timestamptz + make_interval(mins => $4),$4)`, [driver.id, c.id, checkIn, minutes]);
    }
  }
}

// ---- the read-only scenario (also run by the child processes) ----------------------------------

const TODAY_AT = {
  'same instant 2026-10-15T05:30Z': '2026-10-15T05:30:00Z',
  'NY 23:30 Oct 14 / LA 20:30': '2026-10-15T03:30:00Z',
  'NY 02:30 Oct 15 / LA 23:30 Oct 14': '2026-10-15T06:30:00Z',
  'spring forward: NY 23:30 EDT Mar 8 / LA 20:30 PDT': '2026-03-09T03:30:00Z',
  'spring forward: LA 23:30 PDT Mar 8': '2026-03-09T06:30:00Z',
  'fall back: NY 23:30 EST Nov 1': '2026-11-02T04:30:00Z',
  'fall back: LA 23:30 PST Nov 1': '2026-11-02T07:30:00Z',
};
const SKIP_AT = [
  '2026-10-15T11:14:00Z', '2026-10-15T11:15:00Z', '2026-10-15T14:14:00Z', '2026-10-15T14:15:00Z',
  '2026-03-08T11:14:00Z', '2026-03-08T11:15:00Z', '2026-03-08T14:14:00Z', '2026-03-08T14:15:00Z',
  '2026-11-01T12:14:00Z', '2026-11-01T12:15:00Z', '2026-11-01T15:14:00Z', '2026-11-01T15:15:00Z',
];
const PAY_RANGES = [
  ['2026-09-30', '2026-10-01'], ['2026-10-01', '2026-10-02'],
  ['2026-03-07', '2026-03-08'], ['2026-03-08', '2026-03-09'],
  ['2026-10-31', '2026-11-01'], ['2026-11-01', '2026-11-02'],
];

async function scenario() {
  const login = (email) => fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) })
    .then((r) => r.json()).then((b) => b.token);
  const t = {};
  for (const k of ['ny', 'la']) for (const r of ['admin', 'driver', 'parent']) t[`${k}.${r}`] = await login(`${r}@${k}.test`);
  t.school = await login('school@s.test');
  const ids = (await pool.query("SELECT u.email, u.id, (SELECT ps.student_id FROM parent_students ps WHERE ps.parent_user_id = u.id) AS child FROM users u WHERE u.email LIKE 'driver@%' OR u.email LIKE 'parent@%'")).rows;
  const idOf = (email) => ids.find((r) => r.email === email);
  const out = { today: {}, skip: {}, pay: {}, absent: {} };

  for (const [label, at] of Object.entries(TODAY_AT)) {
    clock._pin(at);
    for (const k of ['ny', 'la']) {
      const items = (await api('GET', '/schedule/today', t[`${k}.driver`])).body;
      out.today[`${label} | ${k}`] = items.map((i) => i.student.name.replace(/^\w+ /, '')).filter((n) => n.startsWith('Day')).sort().join(',');
    }
  }
  for (const at of SKIP_AT) {
    clock._pin(at);
    for (const k of ['ny', 'la']) {
      const st = (await api('GET', `/parent/students/${idOf(`parent@${k}.test`).child}/skip-status`, t[`${k}.parent`])).body;
      out.skip[`${at} | ${k}`] = st.eligible;
    }
  }
  clock._pin('2026-12-01T12:00:00Z');
  for (const [from, to] of PAY_RANGES) {
    for (const k of ['ny', 'la']) {
      const s = (await api('GET', `/payroll/summary/${idOf(`driver@${k}.test`).id}?from=${from}&to=${to}`, t[`${k}.admin`])).body;
      out.pay[`${from}..${to} | ${k}`] = s.worked_minutes;
    }
  }
  for (const at of ['2026-10-15T05:30:00Z', '2026-10-15T12:00:00Z']) {
    clock._pin(at);
    for (const who of ['ny.admin', 'la.admin', 'school']) {
      out.absent[`${at} | ${who}`] = (await api('GET', '/dashboard/absent-today', t[who])).body.map((e) => e.student_name).sort().join(',');
    }
  }
  clock._pin(null);
  // Control: what the database session zone itself says (this is what used to decide "today").
  const ctl = (await pool.query("SELECT current_setting('TimeZone') AS tz, ('2026-10-15T05:30:00Z'::timestamptz)::date::text AS session_date")).rows[0];
  return { app: out, control: ctl };
}

// ---- child mode: run the scenario and print it ------------------------------------------------

if (process.env.TZ42_CHILD === '1') {
  const server = createApp().listen(API_PORT, async () => {
    try {
      const r = await scenario();
      process.stdout.write(`RESULT ${JSON.stringify(r)}\n`);
      server.close();
      await pool.end();
      process.exit(0);
    } catch (e) {
      console.error('CHILD FAILED', e);
      process.exit(1);
    }
  });
  return;
}

// ---- parent: the edge assertions --------------------------------------------------------------

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const rec = createRecorder('42-timezone-edges');
const { ok, bad, eq } = rec;

async function main() {
  const epg = await startEmbeddedPostgres('42-timezone-edges', PG_PORT);
  let server;
  try {
    runMigrateUp();
    await seed();
    server = createApp().listen(API_PORT);
    const { app: r } = await scenario();

    console.log('--- same instant, different business dates ---');
    eq('2026-10-15T05:30Z: NY is on Oct 15', r.today['same instant 2026-10-15T05:30Z | ny'], 'Day 2026-10-15');
    eq('2026-10-15T05:30Z: LA is still on Oct 14', r.today['same instant 2026-10-15T05:30Z | la'], 'Day 2026-10-14');

    console.log('\n--- 11:30pm local is still today ---');
    eq('NY 23:30 Oct 14: schedule shows Oct 14, not Oct 15', r.today['NY 23:30 Oct 14 / LA 20:30 | ny'], 'Day 2026-10-14');
    eq('LA 23:30 Oct 14 (06:30Z, already Oct 15 in NY and UTC): LA shows Oct 14', r.today['NY 02:30 Oct 15 / LA 23:30 Oct 14 | la'], 'Day 2026-10-14');
    eq('...while NY at that instant shows Oct 15', r.today['NY 02:30 Oct 15 / LA 23:30 Oct 14 | ny'], 'Day 2026-10-15');

    console.log('\n--- parent skip cutoff: pickup 07:45 -> skippable until 07:15 local ---');
    eq('NY 07:14 EDT (11:14Z): eligible', r.skip['2026-10-15T11:14:00Z | ny'], true);
    eq('NY 07:15 EDT (11:15Z): too late', r.skip['2026-10-15T11:15:00Z | ny'], false);
    eq('LA 04:15 PDT (11:15Z, the same instant): still eligible', r.skip['2026-10-15T11:15:00Z | la'], true);
    eq('LA 07:14 PDT (14:14Z): eligible', r.skip['2026-10-15T14:14:00Z | la'], true);
    eq('LA 07:15 PDT (14:15Z): too late', r.skip['2026-10-15T14:15:00Z | la'], false);

    console.log('\n--- payroll period boundary: the session checked in at 2026-10-01T05:30Z ---');
    eq('NY counts it on Oct 1 (01:30 local)', r.pay['2026-10-01..2026-10-02 | ny'], 60);
    eq('NY: not on Sep 30', r.pay['2026-09-30..2026-10-01 | ny'], 0);
    eq('LA counts it on Sep 30 (22:30 local)', r.pay['2026-09-30..2026-10-01 | la'], 60);
    eq('LA: not on Oct 1', r.pay['2026-10-01..2026-10-02 | la'], 0);

    console.log('\n--- DST spring forward, 2026-03-08 ---');
    eq('NY Mar 8 (23 h day, starts 05:00Z): only the 03:30 EDT shift', r.pay['2026-03-08..2026-03-09 | ny'], 60);
    eq('NY Mar 7: the 23:59 EST shift (04:59Z, one minute before NY Mar 8 began)', r.pay['2026-03-07..2026-03-08 | ny'], 30);
    eq('LA Mar 7: both (20:59 and 23:30 PST)', r.pay['2026-03-07..2026-03-08 | la'], 90);
    eq('LA Mar 8: none', r.pay['2026-03-08..2026-03-09 | la'], 0);
    eq('skip cutoff NY Mar 8: 07:14 EDT = 11:14Z eligible (not 12:14Z, the EST reading)', r.skip['2026-03-08T11:14:00Z | ny'], true);
    eq('skip cutoff NY Mar 8: 07:15 EDT = 11:15Z too late', r.skip['2026-03-08T11:15:00Z | ny'], false);
    eq('skip cutoff LA Mar 8: 07:14 PDT = 14:14Z eligible', r.skip['2026-03-08T14:14:00Z | la'], true);
    eq('skip cutoff LA Mar 8: 07:15 PDT = 14:15Z too late', r.skip['2026-03-08T14:15:00Z | la'], false);
    eq('11:30pm on the spring-forward day, NY: still Mar 8', r.today['spring forward: NY 23:30 EDT Mar 8 / LA 20:30 PDT | ny'], 'Day 2026-03-08');
    eq('11:30pm on the spring-forward day, LA: still Mar 8', r.today['spring forward: LA 23:30 PDT Mar 8 | la'], 'Day 2026-03-08');

    console.log('\n--- DST fall back, 2026-11-01 ---');
    eq('NY Nov 1 (25 h day): both 01:30s (EDT and EST), 03:30 and 04:30 = 4 shifts', r.pay['2026-11-01..2026-11-02 | ny'], 240);
    eq('NY Oct 31: none', r.pay['2026-10-31..2026-11-01 | ny'], 0);
    eq('LA Oct 31: 22:30 and 23:30 PDT', r.pay['2026-10-31..2026-11-01 | la'], 120);
    eq('LA Nov 1: both 01:30s (PDT and PST)', r.pay['2026-11-01..2026-11-02 | la'], 120);
    eq('skip cutoff NY Nov 1: 07:14 EST = 12:14Z eligible', r.skip['2026-11-01T12:14:00Z | ny'], true);
    eq('skip cutoff NY Nov 1: 07:15 EST = 12:15Z too late (not 11:15Z, the EDT reading)', r.skip['2026-11-01T12:15:00Z | ny'], false);
    eq('skip cutoff LA Nov 1: 07:14 PST = 15:14Z eligible', r.skip['2026-11-01T15:14:00Z | la'], true);
    eq('skip cutoff LA Nov 1: 07:15 PST = 15:15Z too late', r.skip['2026-11-01T15:15:00Z | la'], false);
    eq('11:30pm on the fall-back day, NY: still Nov 1', r.today['fall back: NY 23:30 EST Nov 1 | ny'], 'Day 2026-11-01');
    eq('11:30pm on the fall-back day, LA: still Nov 1', r.today['fall back: LA 23:30 PST Nov 1 | la'], 'Day 2026-11-01');

    console.log('\n--- absent today: company date for admins, each row\'s company date for the school ---');
    eq('05:30Z NY admin: NY row (dated Oct 15)', r.absent['2026-10-15T05:30:00Z | ny.admin'], 'NY Absent');
    eq('05:30Z LA admin: LA row (dated Oct 14, LA still on Oct 14)', r.absent['2026-10-15T05:30:00Z | la.admin'], 'LA Absent');
    eq('05:30Z school: both, each by its own company\'s date', r.absent['2026-10-15T05:30:00Z | school'], 'LA Absent,NY Absent');
    eq('12:00Z school: only NY (LA has moved on to Oct 15)', r.absent['2026-10-15T12:00:00Z | school'], 'NY Absent');

    console.log('\n--- writes use the business date too ---');
    const tNyParent = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'parent@ny.test', password: PW }) }).then((x) => x.json()).then((b) => b.token);
    const tLaParent = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'parent@la.test', password: PW }) }).then((x) => x.json()).then((b) => b.token);
    const childOf = async (email) => (await pool.query('SELECT ps.student_id FROM parent_students ps JOIN users u ON u.id = ps.parent_user_id WHERE u.email = $1', [email])).rows[0].student_id;
    clock._pin('2026-10-16T06:00:00Z'); // LA 23:00 Oct 15 (pickup long gone) | NY 02:00 Oct 16
    const laLate = await api('POST', `/parent/students/${await childOf('parent@la.test')}/skip-pickup`, tLaParent, {});
    eq('LA at 23:00 local: today is still Oct 15, its 07:45 pickup has passed -> 403', laLate.status, 403);
    const nyOk = await api('POST', `/parent/students/${await childOf('parent@ny.test')}/skip-pickup`, tNyParent, {});
    eq('NY at the same instant: it is 02:00 Oct 16, before the cutoff -> skipped', nyOk.status, 200);
    eq('...and the skip is dated Oct 16 (NY), not by the DB session zone', (await pool.query("SELECT skip_date::text AS d FROM pickup_skips WHERE student_id = $1", [await childOf('parent@ny.test')])).rows[0]?.d, '2026-10-16');
    clock._pin(null);
    server.close();
    server = null;

    console.log('\n--- the database session timezone no longer decides anything ---');
    const runs = {};
    for (const dbTz of ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      await pool.query(`ALTER DATABASE saferoute_dev SET timezone = '${dbTz}'`);
      const child = spawnSync(process.execPath, [__filename], { env: { ...process.env, TZ42_CHILD: '1' }, encoding: 'utf8', timeout: 120000 });
      const line = child.stdout.split('\n').find((l) => l.startsWith('RESULT '));
      if (!line) { bad(`child under ${dbTz} produced no result: ${child.stderr.slice(-500)}`); continue; }
      runs[dbTz] = JSON.parse(line.slice(7));
      eq(`child really ran with session TimeZone=${dbTz}`, runs[dbTz].control.tz, dbTz);
    }
    await pool.query('ALTER DATABASE saferoute_dev RESET timezone');
    const names = Object.keys(runs);
    if (names.length === 3) {
      const controls = names.map((n) => runs[n].control.session_date);
      eq('control: the session zone does change a plain ::date (UTC, +14, -11)', controls.join(','), '2026-10-15,2026-10-15,2026-10-14');
      const base = JSON.stringify(runs[names[0]].app);
      for (const n of names.slice(1)) eq(`app answers under ${n} identical to ${names[0]} (schedule, skip, payroll, absent)`, JSON.stringify(runs[n].app), base);
      // The children ran after the NY skip above, so compare their results with the parent's
      // except the one absent-today entry that skip added.
      const parentRun = JSON.parse(JSON.stringify(r));
      const childRun = JSON.parse(base);
      delete parentRun.absent; delete childRun.absent;
      eq('...and identical to the parent run (default zone) for schedule, skip and payroll', JSON.stringify(childRun), JSON.stringify(parentRun));
      ok(`${Object.keys(r.today).length + Object.keys(r.skip).length + Object.keys(r.pay).length + Object.keys(r.absent).length} answers compared per run`);
    }
  } catch (e) {
    bad(`unexpected: ${e.stack}`);
  } finally {
    clock._pin(null);
    if (server) server.close();
    try { await pool.end(); } catch { /* already ended */ }
    await epg.stop();
  }
  const { fail } = rec.summarize();
  process.exit(fail === 0 ? 0 : 1);
}

main();
