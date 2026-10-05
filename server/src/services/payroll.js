// Payroll (§7.2). Per-driver rate (hourly OR daily) + freeform "extra work" adjustments,
// and a summary = hours*rate (or days*rate) + adjustments. Money is integer cents throughout.
const pool = require('../db/pool');
const { HttpError, mapMissingRefError } = require('../errors');
const { assignmentRunsOnSql } = require('../db/scoped');
const { dateInZone, startOfDay } = require('../time/businessDate');

// Timezone (branch company-timezone): payroll days are the company's days. A session counts on the
// date it was checked into in the company's zone, and a period [from, to) given as dates runs from
// local midnight of `from` to local midnight of `to` in that zone. Nothing here uses the database
// session timezone (no ::date on a timestamptz, no date strings compared with timestamps in SQL).
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// A period bound as given by the caller: a calendar date ('YYYY-MM-DD', from the pay pages) or an
// instant (paid_through_at, a Date or ISO string). Returns { instant, date } in the company's zone:
// `instant` bounds sessions (check_in_at), `date` bounds adjustments (work_date).
function periodBound(value, timeZone, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    const instant = startOfDay(value, timeZone);
    if (dateInZone(timeZone, instant) !== value) throw new HttpError(400, `${field} must be a real date (YYYY-MM-DD)`);
    return { instant, date: value };
  }
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new HttpError(400, `${field} must be a date (YYYY-MM-DD) or a timestamp`);
  // An instant (the moment a cycle was marked paid): sessions compare exactly; adjustments, which
  // only have a date, use that instant's date in the company's zone. An adjustment dated the paid
  // day therefore still counts as owed, as before (see docs/TIMEZONE_QUESTIONS.md, C2).
  return { instant, date: dateInZone(timeZone, instant) };
}

// Upsert the single pay rule for a driver in the caller's company. The composite FK
// (driver_id, company_id) -> users guarantees the driver belongs to this company, so an
// upsert can't touch another company's driver.
async function upsertRule(req, driverId, body = {}) {
  const { rate_type, rate_cents } = body;
  if (!['hourly', 'daily'].includes(rate_type)) throw new HttpError(400, "rate_type must be 'hourly' or 'daily'");
  if (!Number.isInteger(rate_cents) || rate_cents < 0) throw new HttpError(400, 'rate_cents must be a non-negative integer');
  try {
    const { rows } = await pool.query(
      `INSERT INTO pay_rules (driver_id, company_id, rate_type, rate_cents)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (driver_id) DO UPDATE SET rate_type = EXCLUDED.rate_type, rate_cents = EXCLUDED.rate_cents
         WHERE pay_rules.company_id = EXCLUDED.company_id
       RETURNING *`,
      [driverId, req.auth.tenantId, rate_type, rate_cents]
    );
    // BUG FIX (monitor-role, 2026-09-24): the conflict branch never checked the company. The FK
    // only guards the INSERT; on a conflict Postgres UPDATEs the existing row instead, so an admin
    // of another company who knew a user id could overwrite that user's rate. The WHERE above
    // skips the update for a row in another company, and no row back means "not yours".
    if (!rows[0]) throw new HttpError(400, 'driver not found in your company');
    return rows[0];
  } catch (err) {
    throw mapMissingRefError(err, 'driver not found in your company');
  }
}

async function listRules(req) {
  return req.db.findMany('pay_rules', { orderBy: 'driver_id' });
}

async function addAdjustment(req, body = {}) {
  const { driver_id, amount_cents, note, work_date } = body;
  if (!driver_id || !note || !work_date) throw new HttpError(400, 'driver_id, note and work_date are required');
  if (!Number.isInteger(amount_cents)) throw new HttpError(400, 'amount_cents must be an integer');
  try {
    return await req.db.insert('pay_adjustments', { driver_id, amount_cents, note, work_date });
  } catch (err) {
    throw mapMissingRefError(err, 'driver not found in your company');
  }
}

// Daily-rate pay for one driver over [from, to] (task: shift_period half/full day). A
// completed shift (all of that shift's assigned students have a completed pickup + dropoff,
// or were reported no-show / parent-skipped, which counts as handled — not the driver's
// fault) earns half the flat daily rate; both shifts done = full rate for that day. A shift
// with zero assigned students doesn't pay out, since there's nothing to verify as done.
//
// Legacy sessions (shift_period IS NULL, recorded before this feature existed) keep paying
// the old way — the full rate once per distinct calendar day worked — so re-running summary()
// over a date range from before this shipped doesn't retroactively change old pay.
async function dailyRatePayCents(req, driverId, rule, sessions) {
  if (sessions.length === 0) return 0;

  const legacyDays = new Set(sessions.filter((s) => s.shift_period === null).map((s) => s.work_date));
  let pay = legacyDays.size * rule.rate_cents;

  const byDayShift = new Map();
  for (const s of sessions) {
    if (s.shift_period === null) continue;
    const key = `${s.work_date}|${s.shift_period}`;
    if (!byDayShift.has(key)) byDayShift.set(key, []);
    byDayShift.get(key).push(s.id);
  }

  // Monitors (monitor-role) have no students of their own to account for, so a monitor's shift
  // counts once they checked in and out of it (the sessions here are already checked out). Their
  // attendance is the whole job; tying it to the driver's pickups would dock a monitor for a
  // driver's missed step. Half the daily rate per shift, same as drivers.
  const isMonitor = await userRole(driverId, req.auth.tenantId) === 'monitor';
  for (const [key, sessionIds] of byDayShift) {
    const [workDate, shiftPeriod] = key.split('|');
    if (isMonitor || await isShiftComplete(req, driverId, workDate, shiftPeriod, sessionIds)) {
      pay += Math.round(rule.rate_cents / 2);
    }
  }

  return pay;
}

async function userRole(userId, companyId) {
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1 AND company_id = $2', [userId, companyId]);
  return rows[0]?.role ?? null;
}

// A shift is "complete" for payroll when every student assigned to this driver for that
// shift (shift_period = the shift itself, or 'both') on that date is accounted for: either a
// completed pickup + dropoff trip logged in one of that shift's sessions, or a no-show/parent
// skip recorded for that student on that date+shift.
async function isShiftComplete(req, driverId, workDate, shiftPeriod, sessionIds) {
  const { rows: assigned } = await pool.query(
    `SELECT student_id FROM assignments
      WHERE driver_user_id = $1 AND company_id = $2 AND shift_period IN ($3, 'both')
        AND start_date <= $4 AND (end_date IS NULL OR end_date >= $4)
        AND ${assignmentRunsOnSql('', '$4::date')}`,
    [driverId, req.auth.tenantId, shiftPeriod, workDate]
  );
  if (assigned.length === 0) return false;

  const [{ rows: doneTrips }, { rows: noShows }, { rows: skips }] = await Promise.all([
    pool.query(
      `SELECT student_id, trip_type FROM trips WHERE session_id = ANY($1::uuid[]) AND status = 'complete'`,
      [sessionIds]
    ),
    pool.query(
      `SELECT student_id FROM pickup_no_shows WHERE company_id = $1 AND no_show_date = $2 AND shift_period = $3`,
      [req.auth.tenantId, workDate, shiftPeriod]
    ),
    pool.query(
      `SELECT student_id FROM pickup_skips WHERE company_id = $1 AND skip_date = $2 AND shift_period = $3`,
      [req.auth.tenantId, workDate, shiftPeriod]
    ),
  ]);
  const handled = new Set([...noShows.map((r) => r.student_id), ...skips.map((r) => r.student_id)]);
  const pickedUp = new Set(doneTrips.filter((t) => t.trip_type === 'pickup').map((t) => t.student_id));
  const droppedOff = new Set(doneTrips.filter((t) => t.trip_type === 'dropoff').map((t) => t.student_id));

  return assigned.every((a) => handled.has(a.student_id) || (pickedUp.has(a.student_id) && droppedOff.has(a.student_id)));
}

// Pay owed for a driver over [from, to]: rate applied to worked time + summed adjustments.
// Hourly: minutes/60 * rate, summed across all sessions (both shifts count the same as one
// continuous shift always did). Daily: see dailyRatePayCents above.
//
// BUG FIX (2026-08-27, found while building the Payroll "Paid" feature): adjustments were
// never filtered by `from`/`to` at all — every adjustment ever recorded for a driver bled
// into every summary, including the driver's own "this month" dashboard card. A driver paid
// out for a past adjustment would see it counted again in every later month's total, and
// this session's new "amount owed since last paid" would have been wrong in the same way
// (already-settled adjustments re-appearing as still owed). Adjustments are now filtered by
// `work_date` exactly like sessions are filtered by `check_in_at`.
//
// `adjustmentsFrom` overrides `from` for adjustments only, and goes through periodBound like the
// other bounds (a company-zone date, or an instant converted to its date in the company's zone).
// unpaidSummary passes the paid day so the boundary it reports to the client is the one used here.
async function summary(req, driverId, { from, to, adjustmentsFrom = from } = {}) {
  const rule = (await req.db.findMany('pay_rules', { where: { driver_id: driverId } }))[0];
  if (!rule) throw new HttpError(404, 'no pay rule for this driver');
  const timeZone = req.businessNow.timeZone;
  const start = periodBound(from, timeZone, 'from');
  const end = periodBound(to, timeZone, 'to');
  const adjStart = adjustmentsFrom === from ? start : periodBound(adjustmentsFrom, timeZone, 'adjustmentsFrom');

  const range = [];
  let clause = 'user_id = $1 AND company_id = $2 AND check_out_at IS NOT NULL';
  range.push(driverId, req.auth.tenantId);
  if (start) { range.push(start.instant); clause += ` AND check_in_at >= $${range.length}`; }
  if (end) { range.push(end.instant); clause += ` AND check_in_at < $${range.length}`; }

  // Each session's work day is its check-in date in the company's zone.
  const sessions = (await pool.query(
    `SELECT id, shift_period, check_in_at, duration_minutes FROM sessions WHERE ${clause}`,
    range
  )).rows.map((r) => ({ ...r, work_date: dateInZone(timeZone, r.check_in_at) }));
  const shifts = {
    minutes: sessions.reduce((sum, r) => sum + (r.duration_minutes ?? 0), 0),
    days: new Set(sessions.map((r) => r.work_date)).size,
  };

  const base = rule.rate_type === 'hourly'
    ? Math.round((shifts.minutes / 60) * rule.rate_cents)
    : await dailyRatePayCents(req, driverId, rule, sessions);

  const adjRange = [driverId, req.auth.tenantId];
  let adjClause = 'driver_id = $1 AND company_id = $2';
  // Adjustments have only a date: [adjStart.date, end.date) in the company's zone. adjStart is `from`
  // unless the caller moved the adjustments' start (unpaidSummary, to the paid day).
  if (adjStart) { adjRange.push(adjStart.date); adjClause += ` AND work_date >= $${adjRange.length}::date`; }
  if (end) { adjRange.push(end.date); adjClause += ` AND work_date < $${adjRange.length}::date`; }
  const adjResult = await pool.query(
    `SELECT COALESCE(SUM(amount_cents),0)::int AS total FROM pay_adjustments WHERE ${adjClause}`,
    adjRange
  );
  const adjustments = adjResult.rows[0].total;

  return {
    driver_id: driverId,
    rate_type: rule.rate_type,
    rate_cents: rule.rate_cents,
    worked_minutes: shifts.minutes,
    worked_days: shifts.days,
    base_pay_cents: base,
    adjustments_cents: adjustments,
    total_pay_cents: base + adjustments,
  };
}

// The "current unpaid cycle": everything since paid_through_at (or the beginning of time,
// if never marked paid). Reuses summary() directly rather than duplicating its computation.
//
// The cutoff differs by kind: shifts start at the paid_through_at instant (check_in_at is a
// timestamp), adjustments start on the paid DAY (work_date is a date), so an adjustment dated the
// day the cycle was marked paid is in the new cycle. That day is the paid instant's date in the
// company's time zone (periodBound), computed once here, used for the total and returned as
// adjustments_from so the website lists exactly the adjustments this total counts.
async function unpaidSummary(req, driverId) {
  const rule = (await req.db.findMany('pay_rules', { where: { driver_id: driverId } }))[0];
  if (!rule) throw new HttpError(404, 'no pay rule for this driver');
  const adjustmentsFrom = periodBound(rule.paid_through_at, req.businessNow.timeZone, 'paid_through_at')?.date ?? null;
  const result = await summary(req, driverId, { from: rule.paid_through_at ?? undefined, adjustmentsFrom: adjustmentsFrom ?? undefined });
  return { ...result, paid_through_at: rule.paid_through_at, adjustments_from: adjustmentsFrom };
}

// Marks the current unpaid cycle settled — resets the "owed since" counter to now. Does not
// touch historical sessions/adjustments, only where the cycle boundary is.
async function markPaid(req, driverId) {
  const rule = (await req.db.findMany('pay_rules', { where: { driver_id: driverId } }))[0];
  if (!rule) throw new HttpError(404, 'no pay rule for this driver');
  const paidThroughAt = new Date().toISOString();
  return req.db.update('pay_rules', rule.id, { paid_through_at: paidThroughAt });
}

async function listAdjustments(req, driverId) {
  return req.db.findMany('pay_adjustments', { where: { driver_id: driverId }, orderBy: 'work_date' });
}

// Company-wide payroll snippet for the redesigned Dashboard (2026-08-28): total hours +
// total pay across every driver with a pay rule, over [from, to]. Reuses summary() per
// driver rather than duplicating its computation — small driver counts make the per-driver
// round-trip fine for a dashboard widget, not worth a bespoke aggregate query.
// Monitors (monitor-role) are paid too, so their hours and pay count in the totals;
// driver_count stays drivers only (it is what the dashboard labels "drivers").
async function companySummary(req, { from, to } = {}) {
  const [drivers, monitors, rules] = await Promise.all([
    req.db.findMany('users', { where: { role: 'driver' } }),
    req.db.findMany('users', { where: { role: 'monitor' } }),
    req.db.findMany('pay_rules', {}),
  ]);
  const driverIdsWithRule = new Set(rules.map((r) => r.driver_id));

  let totalMinutes = 0;
  let totalPayCents = 0;
  for (const d of [...drivers, ...monitors]) {
    if (!driverIdsWithRule.has(d.id)) continue;
    const s = await summary(req, d.id, { from, to });
    totalMinutes += s.worked_minutes;
    totalPayCents += s.total_pay_cents;
  }
  return { driver_count: drivers.length, monitor_count: monitors.length, total_minutes: totalMinutes, total_pay_cents: totalPayCents };
}

module.exports = { upsertRule, listRules, addAdjustment, summary, unpaidSummary, markPaid, listAdjustments, companySummary };
