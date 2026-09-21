// Shift-period split (task: morning/afternoon as two fully independent check-in/check-out
// events). Covers: assignments' shift-aware conflict checking, sessions/trips independence
// per shift, shift-scoped no-show double-submit guard, and the new payroll daily-rate
// half/full-day math (including the zero-assignment and no-show-counts-as-handled cases,
// and backward compat for sessions recorded before this feature existed).
const PG_PORT = 5464;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-14';
process.env.NODE_ENV = 'test';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const mailer = require('../src/mail/mailer.js');

const rec = createRecorder('14-shift-period');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:5400';
const PW = 'Secret123!';

async function api(method, p, token, body) {
  const opts = { method, headers: {} };
  if (token) opts.headers.authorization = `Bearer ${token}`;
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(BASE + p, opts);
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: data };
}
const login = async (email) => (await api('POST', '/auth/login', null, { email, password: PW })).body.token;

async function main() {
  const epg = await startEmbeddedPostgres('14-shift-period', PG_PORT);
  try {
    runMigrateUp();

    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const admin = await ins(
      "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('admin@co.com',$1,'Admin','company_admin',$2,now()) RETURNING id",
      [hash, A.id]
    );
    const schoolAdmin = await ins(
      "INSERT INTO users(email,password_hash,full_name,role,school_id,email_verified_at) VALUES('sa@sch.com',$1,'School Admin','school_admin',$2,now()) RETURNING id",
      [hash, S.id]
    );
    async function makeDriver(email, name) {
      return ins(
        "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES($1,$2,$3,'driver',$4,now()) RETURNING id",
        [email, hash, name, A.id]
      );
    }
    const d1 = await makeDriver('d1@co.com', 'Driver One');
    const d2 = await makeDriver('d2@co.com', 'Driver Two');
    const d3 = await makeDriver('d3@co.com', 'Driver Three (no-show)');
    const d4 = await makeDriver('d4@co.com', 'Driver Four (legacy)');
    const d5 = await makeDriver('d5@co.com', 'Driver Five (empty shift)');
    const d6 = await makeDriver('d6@co.com', 'Driver Six (pay math)');
    const van1 = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'AAA-1','Ford','Transit',2022) RETURNING id", [A.id]);
    const van2 = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'BBB-2','Ford','Transit',2022) RETURNING id", [A.id]);
    // Separate vans per driver below (van3, van4) - a van can't be shared by two different
    // drivers over overlapping date ranges, unrelated to shift_period.
    const van3 = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'CCC-3','Ford','Transit',2022) RETURNING id", [A.id]);
    const van4 = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'DDD-4','Ford','Transit',2022) RETURNING id", [A.id]);

    async function makeStudent(name) {
      return ins("INSERT INTO students(company_id,school_id,full_name) VALUES($1,$2,$3) RETURNING id", [A.id, S.id, name]);
    }
    const stuConflict = await makeStudent('Conflict Kid');
    const stuPay = await makeStudent('Pay Kid');
    const stuNoShow = await makeStudent('No-Show Kid');

    const app = createApp();
    const server = app.listen(5400);
    try {
      const adminTok = await login('admin@co.com');
      const schoolAdminTok = await login('sa@sch.com');
      const d1Tok = await login('d1@co.com');
      const d2Tok = await login('d2@co.com');
      const d3Tok = await login('d3@co.com');
      const d5Tok = await login('d5@co.com');
      const d6Tok = await login('d6@co.com');

      console.log('--- Shift-aware assignment conflicts ---');
      const morningAsg = await api('POST', '/assignments', adminTok, {
        student_id: stuConflict.id, driver_user_id: d1.id, van_id: van1.id, start_date: '2020-01-01', shift_period: 'morning',
      });
      eq('morning assignment for d1 -> 201', morningAsg.status, 201);
      const afternoonAsg = await api('POST', '/assignments', adminTok, {
        student_id: stuConflict.id, driver_user_id: d2.id, van_id: van2.id, start_date: '2020-01-01', shift_period: 'afternoon',
      });
      (afternoonAsg.status === 201)
        ? ok('non-overlapping afternoon assignment for a DIFFERENT driver, same student -> 201 (no conflict)')
        : bad(`afternoon assignment: ${afternoonAsg.status} ${JSON.stringify(afternoonAsg.body)}`);
      eq(
        'a second morning assignment for the same student, different driver -> 409 (shifts overlap)',
        (await api('POST', '/assignments', adminTok, {
          student_id: stuConflict.id, driver_user_id: d2.id, van_id: van2.id, start_date: '2020-01-01', shift_period: 'morning',
        })).status,
        409
      );
      eq(
        "a 'both' assignment for the same student, different driver -> 409 (both overlaps everything)",
        (await api('POST', '/assignments', adminTok, {
          student_id: stuConflict.id, driver_user_id: d2.id, van_id: van2.id, start_date: '2020-01-01', shift_period: 'both',
        })).status,
        409
      );
      const defaultAsg = await api('POST', '/assignments', adminTok, {
        student_id: (await makeStudent('Default Shift Kid')).id, driver_user_id: d1.id, van_id: van1.id, start_date: '2020-01-01',
      });
      (defaultAsg.status === 201 && defaultAsg.body.shift_period === 'both')
        ? ok("omitting shift_period on create defaults to 'both' (backward compatible)")
        : bad(`default shift: ${defaultAsg.status} ${JSON.stringify(defaultAsg.body)}`);

      console.log('\n--- Sessions: morning and afternoon are independent check-in/check-out pairs ---');
      eq('check-in with no shift_period -> 400', (await api('POST', '/sessions/checkin', d1Tok, {})).status, 400);
      const ciMorning = await api('POST', '/sessions/checkin', d1Tok, { shift_period: 'morning' });
      eq('morning check-in -> 201', ciMorning.status, 201);
      eq(
        'second morning check-in while morning still open -> 409',
        (await api('POST', '/sessions/checkin', d1Tok, { shift_period: 'morning' })).status,
        409
      );
      const ciAfternoon = await api('POST', '/sessions/checkin', d1Tok, { shift_period: 'afternoon' });
      (ciAfternoon.status === 201)
        ? ok('afternoon check-in succeeds while morning is still open (two independent open shifts)')
        : bad(`afternoon check-in: ${ciAfternoon.status} ${JSON.stringify(ciAfternoon.body)}`);

      console.log('\n--- Trips: shift_period picks which open session a trip belongs to ---');
      eq(
        'log trip with no shift_period -> 400',
        (await api('POST', '/trips', d1Tok, { student_id: stuConflict.id, trip_type: 'pickup' })).status,
        400
      );
      const tripAfternoon = await api('POST', '/trips', d1Tok, { student_id: stuConflict.id, trip_type: 'pickup', shift_period: 'afternoon' });
      (tripAfternoon.status === 201 && tripAfternoon.body.shift_period === 'afternoon' && tripAfternoon.body.session_id === ciAfternoon.body.id)
        ? ok('trip logged with shift_period=afternoon attaches to the afternoon session, not the morning one')
        : bad(`trip: ${tripAfternoon.status} ${JSON.stringify(tripAfternoon.body)}`);

      const coMorning = await api('POST', `/sessions/${ciMorning.body.id}/checkout`, d1Tok, {});
      eq('morning checkout -> 200', coMorning.status, 200);
      const coAfternoon = await api('POST', `/sessions/${ciAfternoon.body.id}/checkout`, d1Tok, {});
      eq('afternoon checkout -> 200', coAfternoon.status, 200);

      console.log('\n--- No-show: one report per (student, date, shift), not per (student, date) ---');
      await api('POST', '/sessions/checkin', d1Tok, { shift_period: 'morning' });
      await api('POST', '/sessions/checkin', d1Tok, { shift_period: 'afternoon' });
      const nsMorning = await api('POST', `/schedule/${morningAsg.body.id}/no-show`, d1Tok, { shift_period: 'morning' });
      eq('morning no-show for stuConflict -> 200', nsMorning.status, 200);
      // stuConflict's afternoon shift belongs to d2, not d1, so report against d1's own
      // 'Default Shift Kid' (both shifts) instead, to prove morning + afternoon no-shows for
      // the SAME student on the SAME day no longer collide under the old (student,date)-only guard.
      const nsMorning2 = await api('POST', `/schedule/${defaultAsg.body.id}/no-show`, d1Tok, { shift_period: 'morning' });
      eq('morning no-show for Default Shift Kid -> 200', nsMorning2.status, 200);
      const nsAfternoon2 = await api('POST', `/schedule/${defaultAsg.body.id}/no-show`, d1Tok, { shift_period: 'afternoon' });
      (nsAfternoon2.status === 200)
        ? ok('afternoon no-show for the SAME student on the SAME day -> 200 (independent of the morning report)')
        : bad(`afternoon no-show: ${nsAfternoon2.status} ${JSON.stringify(nsAfternoon2.body)}`);
      eq(
        'reporting morning no-show again for Default Shift Kid -> 409 (still guards double-submit within a shift)',
        (await api('POST', `/schedule/${defaultAsg.body.id}/no-show`, d1Tok, { shift_period: 'morning' })).status,
        409
      );

      console.log('\n--- Payroll daily rate: half a shift = half the day, full day needs both ---');
      eq('set d6 daily rate $100/day -> 200', (await api('PUT', `/payroll/rules/${d6.id}`, adminTok, { rate_type: 'daily', rate_cents: 10000 })).status, 200);
      // d6's only assignment today, so shift completion is unambiguous: exactly stuPay.
      const payAsg = await api('POST', '/assignments', adminTok, {
        student_id: stuPay.id, driver_user_id: d6.id, van_id: van4.id, start_date: '2020-01-01', shift_period: 'both',
      });
      eq('assignment for pay-test student -> 201', payAsg.status, 201);

      const d6MorningCi = await api('POST', '/sessions/checkin', d6Tok, { shift_period: 'morning' });
      const morningPickup = await api('POST', '/trips', d6Tok, { student_id: stuPay.id, trip_type: 'pickup', shift_period: 'morning' });
      await api('POST', `/trips/${morningPickup.body.id}/confirm`, schoolAdminTok);
      const morningDropoff = await api('POST', '/trips', d6Tok, { student_id: stuPay.id, trip_type: 'dropoff', shift_period: 'morning' });
      await api('POST', `/trips/${morningDropoff.body.id}/confirm`, schoolAdminTok);
      // A session only counts toward pay once checked out (still-open shifts are in progress).
      await api('POST', `/sessions/${d6MorningCi.body.id}/checkout`, d6Tok, {});

      const halfDaySummary = await api('GET', `/payroll/summary/${d6.id}`, adminTok);
      (halfDaySummary.status === 200 && halfDaySummary.body.base_pay_cents === 5000)
        ? ok(`completing only the morning shift pays exactly half the daily rate (base_pay_cents=${halfDaySummary.body.base_pay_cents})`)
        : bad(`half-day summary: ${halfDaySummary.status} ${JSON.stringify(halfDaySummary.body)}`);

      // Now complete the afternoon shift too -> full day.
      const d6AfternoonCi = await api('POST', '/sessions/checkin', d6Tok, { shift_period: 'afternoon' });
      const afternoonPickup = await api('POST', '/trips', d6Tok, { student_id: stuPay.id, trip_type: 'pickup', shift_period: 'afternoon' });
      await api('POST', `/trips/${afternoonPickup.body.id}/confirm`, schoolAdminTok);
      const afternoonDropoff = await api('POST', '/trips', d6Tok, { student_id: stuPay.id, trip_type: 'dropoff', shift_period: 'afternoon' });
      await api('POST', `/trips/${afternoonDropoff.body.id}/confirm`, schoolAdminTok);
      await api('POST', `/sessions/${d6AfternoonCi.body.id}/checkout`, d6Tok, {});

      const fullDaySummary = await api('GET', `/payroll/summary/${d6.id}`, adminTok);
      (fullDaySummary.status === 200 && fullDaySummary.body.base_pay_cents === 10000)
        ? ok(`completing both shifts pays the full daily rate (base_pay_cents=${fullDaySummary.body.base_pay_cents})`)
        : bad(`full-day summary: ${fullDaySummary.status} ${JSON.stringify(fullDaySummary.body)}`);

      console.log("\n--- Payroll: a shift with zero assigned students doesn't pay ---");
      eq('set d5 daily rate $100/day -> 200', (await api('PUT', `/payroll/rules/${d5.id}`, adminTok, { rate_type: 'daily', rate_cents: 10000 })).status, 200);
      const d5CheckIn = await api('POST', '/sessions/checkin', d5Tok, { shift_period: 'morning' });
      await api('POST', `/sessions/${d5CheckIn.body.id}/checkout`, d5Tok, {});
      const d5Summary = await api('GET', `/payroll/summary/${d5.id}`, adminTok);
      (d5Summary.status === 200 && d5Summary.body.base_pay_cents === 0)
        ? ok('checking in/out with zero assigned students that shift -> $0 base pay for that day')
        : bad(`d5 summary: ${d5Summary.status} ${JSON.stringify(d5Summary.body)}`);

      console.log('\n--- Payroll: a no-show counts as handled, still pays the shift ---');
      eq('set d3 daily rate $100/day -> 200', (await api('PUT', `/payroll/rules/${d3.id}`, adminTok, { rate_type: 'daily', rate_cents: 10000 })).status, 200);
      const d3Asg = await api('POST', '/assignments', adminTok, {
        student_id: stuNoShow.id, driver_user_id: d3.id, van_id: van3.id, start_date: '2020-01-01', shift_period: 'both',
      });
      const d3CheckIn = await api('POST', '/sessions/checkin', d3Tok, { shift_period: 'morning' });
      const d3NoShow = await api('POST', `/schedule/${d3Asg.body.id}/no-show`, d3Tok, { shift_period: 'morning' });
      eq('d3 reports a morning no-show for their only assigned student -> 200', d3NoShow.status, 200);
      await api('POST', `/sessions/${d3CheckIn.body.id}/checkout`, d3Tok, {});
      const d3Summary = await api('GET', `/payroll/summary/${d3.id}`, adminTok);
      (d3Summary.status === 200 && d3Summary.body.base_pay_cents === 5000)
        ? ok(`a no-show (not driver's fault) still pays out the half-shift (base_pay_cents=${d3Summary.body.base_pay_cents})`)
        : bad(`d3 summary: ${d3Summary.status} ${JSON.stringify(d3Summary.body)}`);

      console.log('\n--- Payroll: legacy (pre-split) sessions keep paying the old way ---');
      eq('set d4 daily rate $100/day -> 200', (await api('PUT', `/payroll/rules/${d4.id}`, adminTok, { rate_type: 'daily', rate_cents: 10000 })).status, 200);
      // A session with no shift_period, exactly like every row recorded before this feature.
      await pool.query(
        "INSERT INTO sessions(user_id,company_id,check_in_at,check_out_at,duration_minutes) VALUES($1,$2,now(),now()+interval '2 hours',120)",
        [d4.id, A.id]
      );
      const d4Summary = await api('GET', `/payroll/summary/${d4.id}`, adminTok);
      (d4Summary.status === 200 && d4Summary.body.base_pay_cents === 10000)
        ? ok('a legacy NULL-shift_period session still pays the full daily rate for that day (backward compatible)')
        : bad(`d4 summary: ${d4Summary.status} ${JSON.stringify(d4Summary.body)}`);

      console.log("\n--- Parent skip-pickup: split student gets a morning-only vs whole-day choice ---");
      const d7 = await makeDriver('d7@co.com', 'Driver Seven (split morning)');
      const d8 = await makeDriver('d8@co.com', 'Driver Eight (split afternoon)');
      const van5 = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'EEE-5','Ford','Transit',2022) RETURNING id", [A.id]);
      const van6 = await ins("INSERT INTO vans(company_id,license_plate,brand,model,year) VALUES($1,'FFF-6','Ford','Transit',2022) RETURNING id", [A.id]);
      const stuSplit = await makeStudent('Split Kid');
      const parent = await ins(
        "INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at) VALUES('parent1@co.com',$1,'Parent One','parent',$2,now()) RETURNING id",
        [hash, A.id]
      );
      await ins('INSERT INTO parent_students(parent_user_id,student_id,company_id) VALUES($1,$2,$3) RETURNING id', [parent.id, stuSplit.id, A.id]);
      const soon = (await pool.query("SELECT to_char(now() + interval '65 minutes', 'HH24:MI') AS t")).rows[0].t;

      const splitMorningAsg = await api('POST', '/assignments', adminTok, {
        student_id: stuSplit.id, driver_user_id: d7.id, van_id: van5.id, start_date: '2020-01-01', shift_period: 'morning', pickup_time: soon,
      });
      const splitAfternoonAsg = await api('POST', '/assignments', adminTok, {
        student_id: stuSplit.id, driver_user_id: d8.id, van_id: van6.id, start_date: '2020-01-01', shift_period: 'afternoon', pickup_time: soon,
      });
      eq('split morning assignment -> 201', splitMorningAsg.status, 201);
      eq('split afternoon assignment -> 201', splitAfternoonAsg.status, 201);

      const parentTok = await login('parent1@co.com');

      const statusBefore = await api('GET', `/parent/students/${stuSplit.id}/skip-status`, parentTok);
      (statusBefore.status === 200 && statusBefore.body.splitShift === true
        && statusBefore.body.morningOnly.eligible === true && statusBefore.body.wholeDay.eligible === true)
        ? ok('split student skip-status reports splitShift:true, both options eligible')
        : bad(`split status: ${statusBefore.status} ${JSON.stringify(statusBefore.body)}`);

      mailer._reset();
      const morningSkip = await api('POST', `/parent/students/${stuSplit.id}/skip-pickup`, parentTok, { shift_choice: 'morning' });
      (morningSkip.status === 200 && morningSkip.body.skipped === true && morningSkip.body.skips.length === 1)
        ? ok('morning-only skip -> 200, one skip row inserted')
        : bad(`morning skip: ${morningSkip.status} ${JSON.stringify(morningSkip.body)}`);
      const sentMorning = mailer._sent().map((m) => m.to).sort();
      (sentMorning.includes('d7@co.com') && !sentMorning.includes('d8@co.com'))
        ? ok('morning-only skip notifies the morning driver only, not the afternoon driver')
        : bad(`notified: ${JSON.stringify(sentMorning)}`);

      const statusAfterMorning = await api('GET', `/parent/students/${stuSplit.id}/skip-status`, parentTok);
      (statusAfterMorning.body.morningOnly.alreadySkipped === true && statusAfterMorning.body.wholeDay.eligible === true)
        ? ok('after morning-only skip: morningOnly done, wholeDay still offerable since afternoon is still open')
        : bad(`status after morning: ${JSON.stringify(statusAfterMorning.body)}`);

      mailer._reset();
      const wholeDaySkip = await api('POST', `/parent/students/${stuSplit.id}/skip-pickup`, parentTok, { shift_choice: 'whole_day' });
      (wholeDaySkip.status === 200 && wholeDaySkip.body.skips.length === 1)
        ? ok('whole-day skip after morning already done -> 200, only inserts the missing afternoon leg')
        : bad(`whole day skip: ${wholeDaySkip.status} ${JSON.stringify(wholeDaySkip.body)}`);
      const sentWhole = mailer._sent().map((m) => m.to).sort();
      sentWhole.includes('d8@co.com')
        ? ok('whole-day skip notifies the afternoon driver too, not just whichever was skipped first')
        : bad(`notified: ${JSON.stringify(sentWhole)}`);

      eq(
        'whole-day skip again (both legs already done) -> 409',
        (await api('POST', `/parent/students/${stuSplit.id}/skip-pickup`, parentTok, { shift_choice: 'whole_day' })).status,
        409
      );

      const detailSplit = await api('GET', `/parent/students/${stuSplit.id}/detail`, parentTok);
      (detailSplit.status === 200 && detailSplit.body.transport.length === 2 && detailSplit.body.skip_today === true)
        ? ok('parent detail for a split student returns both transport entries, skip_today true once both shifts skipped')
        : bad(`split detail: ${detailSplit.status} ${JSON.stringify(detailSplit.body)}`);

      console.log("\n--- Parent skip-pickup: non-split student keeps the old one-click behavior ---");
      const stuSingle = await makeStudent('Single Kid');
      await ins('INSERT INTO parent_students(parent_user_id,student_id,company_id) VALUES($1,$2,$3) RETURNING id', [parent.id, stuSingle.id, A.id]);
      const singleAsg = await api('POST', '/assignments', adminTok, {
        student_id: stuSingle.id, driver_user_id: d7.id, van_id: van5.id, start_date: '2020-01-01', pickup_time: soon,
      });
      eq('single assignment, shift_period omitted -> 201 (defaults to both)', singleAsg.status, 201);
      const statusSingle = await api('GET', `/parent/students/${stuSingle.id}/skip-status`, parentTok);
      (statusSingle.status === 200 && statusSingle.body.splitShift === false && statusSingle.body.eligible === true)
        ? ok('non-split student skip-status keeps the old flat shape (splitShift:false)')
        : bad(`single status: ${statusSingle.status} ${JSON.stringify(statusSingle.body)}`);
      const singleSkip = await api('POST', `/parent/students/${stuSingle.id}/skip-pickup`, parentTok, {});
      (singleSkip.status === 200 && singleSkip.body.skips.length === 1)
        ? ok('non-split skip-pickup works with no shift_choice, same one-click behavior as before')
        : bad(`single skip: ${singleSkip.status} ${JSON.stringify(singleSkip.body)}`);
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
