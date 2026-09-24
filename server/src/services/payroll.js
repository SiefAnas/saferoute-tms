// Payroll (§7.2). Per-driver rate (hourly OR daily) + freeform "extra work" adjustments,
// and a summary = hours*rate (or days*rate) + adjustments. Money is integer cents throughout.
const pool = require('../db/pool');
const { HttpError, mapMissingRefError } = require('../errors');
const { assignmentRunsOnSql } = require('../db/scoped');

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
       RETURNING *`,
      [driverId, req.auth.tenantId, rate_type, rate_cents]
    );
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
async function dailyRatePayCents(req, driverId, rule, sessionsClause, sessionsRange) {
  const { rows: sessions } = await pool.query(
    `SELECT id, shift_period, check_in_at::date::text AS work_date
       FROM sessions WHERE ${sessionsClause}`,
    sessionsRange
  );
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

  for (const [key, sessionIds] of byDayShift) {
    const [workDate, shiftPeriod] = key.split('|');
    if (await isShiftComplete(req, driverId, workDate, shiftPeriod, sessionIds)) {
      pay += Math.round(rule.rate_cents / 2);
    }
  }

  return pay;
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
async function summary(req, driverId, { from, to } = {}) {
  const rule = (await req.db.findMany('pay_rules', { where: { driver_id: driverId } }))[0];
  if (!rule) throw new HttpError(404, 'no pay rule for this driver');

  const range = [];
  let clause = 'user_id = $1 AND company_id = $2 AND check_out_at IS NOT NULL';
  range.push(driverId, req.auth.tenantId);
  if (from) { range.push(from); clause += ` AND check_in_at >= $${range.length}`; }
  if (to) { range.push(to); clause += ` AND check_in_at < $${range.length}`; }

  const shifts = (await pool.query(
    `SELECT COALESCE(SUM(duration_minutes),0)::int AS minutes,
            COUNT(DISTINCT check_in_at::date)::int AS days
       FROM sessions WHERE ${clause}`,
    range
  )).rows[0];

  const base = rule.rate_type === 'hourly'
    ? Math.round((shifts.minutes / 60) * rule.rate_cents)
    : await dailyRatePayCents(req, driverId, rule, clause, range);

  const adjRange = [driverId, req.auth.tenantId];
  let adjClause = 'driver_id = $1 AND company_id = $2';
  if (from) { adjRange.push(from); adjClause += ` AND work_date >= $${adjRange.length}`; }
  if (to) { adjRange.push(to); adjClause += ` AND work_date < $${adjRange.length}`; }
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
async function unpaidSummary(req, driverId) {
  const rule = (await req.db.findMany('pay_rules', { where: { driver_id: driverId } }))[0];
  if (!rule) throw new HttpError(404, 'no pay rule for this driver');
  const result = await summary(req, driverId, { from: rule.paid_through_at ?? undefined });
  return { ...result, paid_through_at: rule.paid_through_at };
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
async function companySummary(req, { from, to } = {}) {
  const [drivers, rules] = await Promise.all([
    req.db.findMany('users', { where: { role: 'driver' } }),
    req.db.findMany('pay_rules', {}),
  ]);
  const driverIdsWithRule = new Set(rules.map((r) => r.driver_id));

  let totalMinutes = 0;
  let totalPayCents = 0;
  for (const d of drivers) {
    if (!driverIdsWithRule.has(d.id)) continue;
    const s = await summary(req, d.id, { from, to });
    totalMinutes += s.worked_minutes;
    totalPayCents += s.total_pay_cents;
  }
  return { driver_count: drivers.length, total_minutes: totalMinutes, total_pay_cents: totalPayCents };
}

module.exports = { upsertRule, listRules, addAdjustment, summary, unpaidSummary, markPaid, listAdjustments, companySummary };
