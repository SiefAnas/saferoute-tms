// Driver sign-in reminder (branch signin-reminder). Migration 038.
//
// A driver gets a push N minutes before the FIRST STOP of each run they drive that day:
//   morning run:   the earliest pickup time of the day's morning students;
//   afternoon run: the earliest drop-off time of the day's afternoon students.
// Times follow that day's schedule changes (one-off overrides), and stops that won't happen are
// left out (a "no ride" override, or a parent's skip for that run). No run that day (or no times
// set) = no reminder. A driver who has already signed in (checked in) for that run gets nothing.
//
// N = the driver's own minutes, else the company default (companies.signin_reminder_minutes).
// Company default NULL = off for everyone; users.signin_reminder_off = off for that driver.
//
// Sent through sendPush (services/push.js), so it is stored and shows in the bell. Each reminder
// goes out once: signin_reminders_sent is claimed with INSERT ... ON CONFLICT DO NOTHING, so the
// API's own sweep and the cron job (scripts/send-due-notifications.js) never double up. A reminder
// is only sent between its time and the first stop: a sweep that runs after the run has started
// sends nothing (a late reminder is noise).
const pool = require('../db/pool');
const { HttpError } = require('../errors');
const { assignmentNotEndedSql, assignmentRunsOnSql } = require('../db/scoped');
const { nowInZone, dayRange, minutesOfTime, DEFAULT_TIME_ZONE } = require('../time/businessDate');
const { sendPush } = require('./push');

const MIN = 5;
const MAX = 240;

function minutesOrNull(value, field) {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < MIN || value > MAX) {
    throw new HttpError(400, `${field} must be a whole number of minutes from ${MIN} to ${MAX} (or null for off)`);
  }
  return value;
}

// ---- settings (company admin) ----

// GET /signin-reminders: the company default and every driver's own setting.
async function getSettings(req) {
  const [{ rows: [c] }, { rows: drivers }] = await Promise.all([
    pool.query('SELECT signin_reminder_minutes FROM companies WHERE id = $1', [req.auth.tenantId]),
    pool.query(
      `SELECT id, full_name, signin_reminder_minutes, signin_reminder_off FROM users
        WHERE company_id = $1 AND role = 'driver' AND is_active ORDER BY full_name`,
      [req.auth.tenantId]
    ),
  ]);
  const def = c?.signin_reminder_minutes ?? null;
  return {
    default_minutes: def,
    drivers: drivers.map((d) => ({
      id: d.id,
      full_name: d.full_name,
      mode: d.signin_reminder_off ? 'off' : d.signin_reminder_minutes !== null ? 'custom' : 'default',
      minutes: d.signin_reminder_minutes,
      effective_minutes: def === null || d.signin_reminder_off ? null : (d.signin_reminder_minutes ?? def),
    })),
  };
}

// PUT /signin-reminders { default_minutes: 5..240 | null (off) }. Drivers with their own minutes
// keep them.
async function setDefault(req, body = {}) {
  if (body.default_minutes === undefined) throw new HttpError(400, 'default_minutes is required (null turns reminders off)');
  const minutes = minutesOrNull(body.default_minutes, 'default_minutes');
  await pool.query('UPDATE companies SET signin_reminder_minutes = $2 WHERE id = $1', [req.auth.tenantId, minutes]);
  return getSettings(req);
}

// PUT /signin-reminders/drivers/:id { mode: 'default' | 'custom' | 'off', minutes? }
async function setDriver(req, driverId, body = {}) {
  const { mode } = body;
  if (!['default', 'custom', 'off'].includes(mode)) throw new HttpError(400, "mode must be 'default', 'custom' or 'off'");
  const minutes = mode === 'custom' ? minutesOrNull(body.minutes ?? -1, 'minutes') : null;
  const { rowCount } = await pool.query(
    `UPDATE users SET signin_reminder_minutes = $3, signin_reminder_off = $4
      WHERE id::text = $1 AND company_id = $2 AND role = 'driver'`,
    [String(driverId), req.auth.tenantId, minutes, mode === 'off']
  );
  if (!rowCount) throw new HttpError(404, 'driver not found');
  return (await getSettings(req)).drivers.find((d) => d.id === String(driverId));
}

// ---- the reminder itself ----

// First stop of each run, per driver, for one company and day. Returns
// [{ driverId, shift, firstStop: 'HH:MM:SS' }].
async function firstStops(companyId, day) {
  const { rows } = await pool.query(
    `SELECT a.driver_user_id, p.shift, min(p.t) AS first_stop
       FROM assignments a
       LEFT JOIN assignment_schedule_overrides o ON o.assignment_id = a.id AND o.override_date = $2::date
       CROSS JOIN LATERAL (VALUES
         ('morning',   COALESCE(o.pickup_time,  a.pickup_time),  a.shift_period IN ('morning', 'both')),
         ('afternoon', COALESCE(o.dropoff_time, a.dropoff_time), a.shift_period IN ('afternoon', 'both'))
       ) AS p(shift, t, runs)
      WHERE a.company_id = $1 AND a.start_date <= $2::date
        AND ${assignmentNotEndedSql('a', '$2::date')} AND ${assignmentRunsOnSql('a', '$2::date')}
        AND p.runs AND p.t IS NOT NULL
        AND NOT COALESCE(o.skip, false)
        AND NOT EXISTS (SELECT 1 FROM pickup_skips ps WHERE ps.student_id = a.student_id
                          AND ps.skip_date = $2::date AND ps.shift_period = p.shift)
      GROUP BY a.driver_user_id, p.shift`,
    [companyId, day]
  );
  return rows.map((r) => ({ driverId: r.driver_user_id, shift: r.shift, firstStop: r.first_stop }));
}

function clock(time) {
  const [h, m] = String(time).split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// One company, at one moment: send what is due. Returns the reminders sent.
async function remindCompany(company, now = new Date()) {
  if (company.signin_reminder_minutes === null || company.signin_reminder_minutes === undefined) return 0;
  const tz = company.timezone ?? DEFAULT_TIME_ZONE;
  const local = nowInZone(tz, now);
  const day = local.date;
  const stops = await firstStops(company.id, day);
  if (!stops.length) return 0;

  const { rows: drivers } = await pool.query(
    `SELECT id, signin_reminder_minutes, signin_reminder_off FROM users
      WHERE company_id = $1 AND role = 'driver' AND is_active AND id = ANY($2::uuid[])`,
    [company.id, [...new Set(stops.map((s) => s.driverId))]]
  );
  const byId = new Map(drivers.map((d) => [d.id, d]));
  const today = dayRange(day, tz);
  let sent = 0;

  for (const s of stops) {
    const d = byId.get(s.driverId);
    if (!d || d.signin_reminder_off) continue;
    const lead = d.signin_reminder_minutes ?? company.signin_reminder_minutes;
    const stopAt = minutesOfTime(s.firstStop);
    // Due from (first stop - lead) until the first stop itself.
    if (local.minutesOfDay < stopAt - lead || local.minutesOfDay >= stopAt) continue;

    // Already signed in for this run today (open or finished): nothing to remind.
    const { rows: signedIn } = await pool.query(
      `SELECT 1 FROM sessions WHERE user_id = $1 AND company_id = $2 AND shift_period = $3
          AND check_in_at >= $4 AND check_in_at < $5 LIMIT 1`,
      [d.id, company.id, s.shift, today.start, today.end]
    );
    if (signedIn.length) continue;

    const claim = await pool.query(
      `INSERT INTO signin_reminders_sent (driver_user_id, run_date, shift_period, first_stop_time)
       VALUES ($1, $2::date, $3, $4) ON CONFLICT DO NOTHING`,
      [d.id, day, s.shift, s.firstStop]
    );
    if (!claim.rowCount) continue;

    const minutesLeft = stopAt - local.minutesOfDay;
    try {
      await sendPush(
        d.id,
        'Time to sign in',
        `Your ${s.shift} run's first stop is at ${clock(s.firstStop)} (in ${minutesLeft} min). Sign in before you head out.`,
        { kind: 'signin_reminder', shift_period: s.shift, route: '/(driver)/today', web_route: '/driver' },
        { category: 'signin_reminder' }
      );
      sent += 1;
    } catch (err) {
      console.error('[signin-reminder] push failed', err?.message ?? err);
    }
  }
  return sent;
}

// The sweep: every company with reminders on. Runs every minute in the API (src/index.js) and in
// the cron job (scripts/send-due-notifications.js), so it still fires when the API is asleep.
async function runSigninReminders({ now = new Date() } = {}) {
  const { rows: companies } = await pool.query(
    "SELECT id, timezone, signin_reminder_minutes FROM companies WHERE claim_status = 'claimed' AND signin_reminder_minutes IS NOT NULL"
  );
  let sent = 0;
  for (const c of companies) {
    sent += await remindCompany(c, now).catch((err) => {
      console.error('[signin-reminder] company failed', c.id, err?.message ?? err);
      return 0;
    });
  }
  return sent;
}

module.exports = { getSettings, setDefault, setDriver, runSigninReminders, firstStops };
