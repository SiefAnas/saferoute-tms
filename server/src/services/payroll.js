// Payroll (§7.2). Per-driver rate (hourly OR daily) + freeform "extra work" adjustments,
// and a summary = hours*rate (or days*rate) + adjustments. Money is integer cents throughout.
const pool = require('../db/pool');
const { HttpError } = require('../errors');

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
    if (err.code === '23503') throw new HttpError(400, 'driver not found in your company');
    throw err;
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
    if (err.code === '23503') throw new HttpError(400, 'driver not found in your company');
    throw err;
  }
}

// Pay owed for a driver over [from, to]: rate applied to worked time + summed adjustments.
// Hourly: minutes/60 * rate. Daily: distinct worked calendar days * rate.
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
            COUNT(DISTINCT (check_in_at AT TIME ZONE 'UTC')::date)::int AS days
       FROM sessions WHERE ${clause}`,
    range
  )).rows[0];

  const base = rule.rate_type === 'hourly'
    ? Math.round((shifts.minutes / 60) * rule.rate_cents)
    : shifts.days * rule.rate_cents;

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
