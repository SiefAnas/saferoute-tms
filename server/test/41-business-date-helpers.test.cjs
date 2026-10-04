// Business-date helpers (branch company-timezone, task 2): pure unit checks of
// server/src/time/businessDate.js and the request middleware. No database. Every check pins `now`.
// The whole file also runs again in child processes with a different process TZ, to show the
// results don't depend on the machine's own timezone.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5486/none'; // pool is never used here
const { spawnSync } = require('node:child_process');
const { createRecorder } = require('./lib/testkit.cjs');
const tz = require('../src/time/businessDate.js');
const clock = require('../src/time/clock.js');
const attachBusinessDate = require('../src/middleware/businessDate.js');

const rec = createRecorder(`41-business-date-helpers${process.env.TZ ? ` (process TZ=${process.env.TZ})` : ''}`);
const { eq } = rec;
const NY = 'America/New_York';
const LA = 'America/Los_Angeles';
const at = (iso) => new Date(iso);

async function main() {
  console.log('--- same instant, different business dates ---');
  // 2026-10-15 03:30Z = Oct 14 23:30 in New York (EDT, -4) and Oct 14 20:30 in Los Angeles (PDT, -7).
  eq('NY at 03:30Z is still Oct 14', tz.dateInZone(NY, at('2026-10-15T03:30:00Z')), '2026-10-14');
  eq('LA at 03:30Z is Oct 14', tz.dateInZone(LA, at('2026-10-15T03:30:00Z')), '2026-10-14');
  // 2026-10-15 05:30Z = Oct 15 01:30 NY, Oct 14 22:30 LA.
  eq('NY at 05:30Z is Oct 15', tz.dateInZone(NY, at('2026-10-15T05:30:00Z')), '2026-10-15');
  eq('LA at 05:30Z is still Oct 14', tz.dateInZone(LA, at('2026-10-15T05:30:00Z')), '2026-10-14');
  eq('UTC at 05:30Z', tz.dateInZone('UTC', at('2026-10-15T05:30:00Z')), '2026-10-15');

  console.log('\n--- the current moment in a zone ---');
  const n = tz.nowInZone(NY, at('2026-10-15T03:30:00Z'));
  eq('11:30pm local: date, time, minutes', JSON.stringify([n.date, n.time, n.minutesOfDay]), JSON.stringify(['2026-10-14', '23:30:00', 23 * 60 + 30]));
  eq('midnight reads 00:00 (not 24:00)', tz.nowInZone(NY, at('2026-10-15T04:00:00Z')).time, '00:00:00');
  eq('businessDateFor(company row)', await tz.businessDateFor({ timezone: LA }, at('2026-10-15T05:30:00Z')), '2026-10-14');
  eq('businessNowFor(company row).time', (await tz.businessNowFor({ timezone: LA }, at('2026-10-15T05:30:00Z'))).time, '22:30:00');
  eq('a row without a zone falls back to the default', await tz.businessDateFor({}, at('2026-10-15T03:30:00Z')), '2026-10-14');

  console.log('\n--- the pinned clock (default `now`) ---');
  clock._pin('2026-10-15T05:30:00Z');
  eq('dateInZone uses the pinned clock', tz.dateInZone(LA), '2026-10-14');
  const req = { auth: { tenantType: 'company', companyTimeZone: LA } };
  attachBusinessDate(req);
  eq('middleware: req.businessDate from the company zone', req.businessDate, '2026-10-14');
  eq('middleware: req.now is the pinned instant', req.now.toISOString(), '2026-10-15T05:30:00.000Z');
  eq('middleware: local time', req.businessNow.time, '22:30:00');
  const sreq = { auth: { tenantType: 'school' } };
  attachBusinessDate(sreq);
  eq('middleware: school users have no single business date', JSON.stringify([sreq.businessDate, sreq.businessNow]), '[null,null]');
  clock._pin(null);
  eq('unpinned again: real clock', Math.abs(clock.now() - Date.now()) < 1000, true);

  console.log('\n--- start of a local day (payroll boundaries), incl. DST ---');
  eq('NY ordinary day starts 04:00Z (EDT)', tz.startOfDay('2026-10-14', NY).toISOString(), '2026-10-14T04:00:00.000Z');
  eq('LA ordinary day starts 07:00Z (PDT)', tz.startOfDay('2026-10-14', LA).toISOString(), '2026-10-14T07:00:00.000Z');
  eq('NY winter day starts 05:00Z (EST)', tz.startOfDay('2026-12-01', NY).toISOString(), '2026-12-01T05:00:00.000Z');
  eq('NY spring-forward day (Mar 8) starts 05:00Z', tz.startOfDay('2026-03-08', NY).toISOString(), '2026-03-08T05:00:00.000Z');
  eq('NY day after spring forward starts 04:00Z', tz.startOfDay('2026-03-09', NY).toISOString(), '2026-03-09T04:00:00.000Z');
  eq('LA fall-back day (Nov 1) starts 07:00Z', tz.startOfDay('2026-11-01', LA).toISOString(), '2026-11-01T07:00:00.000Z');
  eq('LA day after fall back starts 08:00Z', tz.startOfDay('2026-11-02', LA).toISOString(), '2026-11-02T08:00:00.000Z');
  eq('NY spring-forward day is 23 hours long', (tz.startOfDay('2026-03-09', NY) - tz.startOfDay('2026-03-08', NY)) / 3600000, 23);
  eq('LA fall-back day is 25 hours long', (tz.startOfDay('2026-11-02', LA) - tz.startOfDay('2026-11-01', LA)) / 3600000, 25);
  // America/Havana springs forward at midnight (00:00 -> 01:00): that local date starts at 01:00.
  const havana = tz.startOfDay('2026-03-08', 'America/Havana');
  eq('a zone whose DST skips midnight: the day starts at its first real instant', tz.nowInZone('America/Havana', havana).date, '2026-03-08');

  console.log('\n--- calendar arithmetic (no zone) ---');
  eq('addDays across a month', tz.addDays('2026-01-31', 1), '2026-02-01');
  eq('addDays across leap day', tz.addDays('2028-02-28', 1), '2028-02-29');
  eq('addDays backwards across a year', tz.addDays('2027-01-01', -1), '2026-12-31');
  eq('addDays across spring forward', tz.addDays('2026-03-07', 2), '2026-03-09');
  eq('minutesOfTime', tz.minutesOfTime('07:45:00'), 465);

  console.log('\n--- validation ---');
  for (const ok of ['America/New_York', 'America/Los_Angeles', 'Africa/Cairo', 'Asia/Kolkata', 'UTC', 'America/Argentina/Buenos_Aires']) {
    eq(`valid: ${ok}`, tz.isValidTimeZone(ok), true);
  }
  for (const bad of ['', 'EST', '+05:00', 'America/Nowhere', 'New York', 'america new_york', null, 5, 'America/New_York; DROP TABLE x']) {
    eq(`invalid: ${JSON.stringify(bad)}`, tz.isValidTimeZone(bad), false);
  }

  if (!process.env.TZ) {
    console.log('\n--- the same file under other process timezones ---');
    for (const processTz of ['UTC', 'Asia/Tokyo', 'Pacific/Honolulu']) {
      const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, TZ: processTz }, encoding: 'utf8' });
      const line = r.stdout.split('\n').find((l) => l.startsWith('===='));
      eq(`process TZ=${processTz}: every check passes`, r.status === 0 && /0 failed/.test(line ?? ''), true);
    }
  }

  const { fail } = rec.summarize();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
