// Monitor stop status and alerts (branch monitor-crew-status). Migration 036.
//
// On the driver's run the monitor is the first stop. The driver presses "Picked up", "No show" or
// "Dropped off" (any time, usually at the end of the run); either the driver or the monitor can
// press "Running late", and the other one gets a push. The company admins get a push:
//   - right away on "No show";
//   - 4 minutes (MONITOR_LATE_ESCALATE_MINUTES) after "Running late" if the monitor still isn't
//     picked up. This is a scheduled sendPush (services/push.js), cancelled by "Picked up" or
//     "No show", so it goes out through the same sweep as every other scheduled notification.
// Admin pushes carry data.kind 'monitor_alert' plus who / which run / what happened, which is
// what the admin's red banner shows (GET /notifications?kind=monitor_alert&unread=1).
//
// Nothing here blocks the run: no button needs another one first, the driver's student stops
// don't look at this at all, and a failed push never fails the button. These records are not
// the monitor's hours: those are their own check-in / check-out in `sessions`, untouched here.
const pool = require('../db/pool');
const { HttpError } = require('../errors');
const { monitorLateEscalateMinutes } = require('../config');
const { assignmentNotEndedSql, assignmentRunsOnSql } = require('../db/scoped');
const { sendPush, cancelScheduled } = require('./push');

const SHIFTS = ['morning', 'afternoon'];
const DRIVER_ACTIONS = ['picked_up', 'no_show', 'dropped_off', 'running_late'];
const SHIFT_WORD = { morning: 'morning', afternoon: 'afternoon' };

function stopStatus(s) {
  if (!s) return 'pending';
  if (s.dropped_off_at) return 'dropped_off';
  if (s.picked_up_at) return 'picked_up';
  if (s.no_show_at) return 'no_show';
  if (s.late_reported_at) return 'late';
  return 'pending';
}

function publicStop(s) {
  if (!s) return null;
  return {
    status: stopStatus(s),
    picked_up_at: s.picked_up_at,
    no_show_at: s.no_show_at,
    dropped_off_at: s.dropped_off_at,
    late_reported_at: s.late_reported_at,
    late_reported_by: s.late_reported_by,
    escalate_at: s.picked_up_at || s.no_show_at ? null : s.escalate_at,
  };
}

function assertShift(shift) {
  if (!SHIFTS.includes(shift)) throw new HttpError(400, "shift_period must be 'morning' or 'afternoon'");
}

// The monitor's ride today (company business date) on this run, with names and the driver's van.
// `driverId` limits it to that driver (a driver can only act on their own monitors).
async function rideToday(req, { monitorId, driverId = null, shift }) {
  const { rows } = await pool.query(
    `SELECT ma.monitor_user_id, ma.driver_user_id, m.full_name AS monitor_name, d.full_name AS driver_name
       FROM monitor_assignments ma
       JOIN users m ON m.id = ma.monitor_user_id AND m.company_id = ma.company_id AND m.is_active
       JOIN users d ON d.id = ma.driver_user_id AND d.company_id = ma.company_id
      WHERE ma.company_id = $1 AND ma.monitor_user_id::text = $2
        AND ($3::uuid IS NULL OR ma.driver_user_id = $3)
        AND EXTRACT(ISODOW FROM $4::date)::smallint = ANY(ma.days_of_week)
        AND ma.shift_period IN ($5, 'both')`,
    [req.auth.tenantId, String(monitorId), driverId, req.businessDate, shift]
  );
  const ride = rows[0];
  if (!ride) return null;
  const { rows: vans } = await pool.query(
    `SELECT v.number, v.license_plate FROM assignments a JOIN vans v ON v.id = a.van_id AND v.company_id = a.company_id
      WHERE a.driver_user_id = $1 AND a.company_id = $2 AND a.start_date <= $3::date
        AND ${assignmentNotEndedSql('a', '$3::date')} AND ${assignmentRunsOnSql('a', '$3::date')}
      LIMIT 1`,
    [ride.driver_user_id, req.auth.tenantId, req.businessDate]
  );
  const van = vans[0];
  return { ...ride, shift, runDate: req.businessDate, van: van ? (van.number ? `Van ${van.number}` : van.license_plate) : null };
}

async function upsertStop(req, ride) {
  const { rows } = await pool.query(
    `INSERT INTO monitor_stops (company_id, driver_user_id, monitor_user_id, run_date, shift_period)
     VALUES ($1, $2, $3, $4::date, $5)
     ON CONFLICT (monitor_user_id, run_date, shift_period) DO UPDATE SET driver_user_id = EXCLUDED.driver_user_id
     RETURNING *`,
    [req.auth.tenantId, ride.driver_user_id, ride.monitor_user_id, ride.runDate, ride.shift]
  );
  return rows[0];
}

async function logEvent(stopId, event, actorId) {
  await pool.query('INSERT INTO monitor_stop_events (monitor_stop_id, event, actor_user_id) VALUES ($1, $2, $3)', [stopId, event, actorId]);
}

async function companyAdminIds(companyId) {
  const { rows } = await pool.query("SELECT id FROM users WHERE company_id = $1 AND role = 'company_admin' AND is_active", [companyId]);
  return rows.map((r) => r.id);
}

// A push must never fail the button: log and carry on.
async function safely(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[monitor-stops] ${label} failed`, err?.message ?? err);
    return null;
  }
}

const escalationCategory = (stopId) => `monitor_late:${stopId}`;

async function cancelEscalation(companyId, stopId) {
  for (const adminId of await companyAdminIds(companyId)) {
    await cancelScheduled({ userId: adminId, category: escalationCategory(stopId) });
  }
}

function tripText(ride) {
  return `${ride.driver_name}'s ${SHIFT_WORD[ride.shift]} run${ride.van ? ` (${ride.van})` : ''}`;
}

// What the admin's push and red banner carry.
function alertData(ride, event) {
  return {
    kind: 'monitor_alert',
    event, // 'no_show' | 'not_picked_up'
    driver_name: ride.driver_name,
    monitor_name: ride.monitor_name,
    shift_period: ride.shift,
    run_date: ride.runDate,
    van: ride.van,
    route: '/(company)/people',
    web_route: '/company/monitors',
  };
}

async function notifyAdmins(companyId, title, body, data, options) {
  for (const adminId of await companyAdminIds(companyId)) {
    await safely('admin push', () => sendPush(adminId, title, body, data, options));
  }
}

async function reportLate(req, ride, stop, by) {
  if (stop.picked_up_at) throw new HttpError(409, 'the monitor is already picked up');
  if (stop.no_show_at) throw new HttpError(409, 'the monitor is already marked as a no show');
  const { rows } = await pool.query(
    `UPDATE monitor_stops SET late_reported_at = now(), late_reported_by = $2,
            escalate_at = now() + make_interval(mins => $3)
      WHERE id = $1 RETURNING *`,
    [stop.id, by, monitorLateEscalateMinutes]
  );
  const updated = rows[0];
  await logEvent(stop.id, 'running_late', req.auth.userId);

  // The other one hears about it.
  if (by === 'driver') {
    await safely('monitor push', () => sendPush(ride.monitor_user_id, 'Your driver is running late',
      `${ride.driver_name} is running late and will be there shortly.`,
      { kind: 'crew_late', route: '/(monitor)/home', web_route: '/monitor' }));
  } else {
    await safely('driver push', () => sendPush(ride.driver_user_id, 'Your monitor is running late',
      `${ride.monitor_name} is running late and will be there shortly.`,
      { kind: 'crew_late', route: '/(driver)/today', web_route: '/driver' }));
  }

  // The admins, in 4 minutes, unless the monitor is picked up (or marked no show) first. A new
  // "Running late" restarts the 4 minutes.
  await safely('cancel escalation', () => cancelEscalation(req.auth.tenantId, stop.id));
  const who = by === 'driver' ? ride.driver_name : ride.monitor_name;
  await notifyAdmins(
    req.auth.tenantId,
    `Monitor not picked up: ${ride.monitor_name}`,
    `${tripText(ride)}: ${ride.monitor_name} is still not picked up ${monitorLateEscalateMinutes} minutes after ${who} said they were running late.`,
    alertData(ride, 'not_picked_up'),
    { sendAt: updated.escalate_at, category: escalationCategory(stop.id) }
  );
  return updated;
}

// POST /schedule/monitors/:monitorId/status { shift_period, action } (driver, own monitors, today).
async function driverStopAction(req, monitorId, body = {}) {
  const { shift_period: shift, action } = body;
  assertShift(shift);
  if (!DRIVER_ACTIONS.includes(action)) throw new HttpError(400, `action must be one of ${DRIVER_ACTIONS.join(', ')}`);
  const ride = await rideToday(req, { monitorId, driverId: req.auth.userId, shift });
  if (!ride) throw new HttpError(404, `this monitor is not on your ${shift} run today`);
  let stop = await upsertStop(req, ride);

  if (action === 'running_late') {
    stop = await reportLate(req, ride, stop, 'driver');
  } else if (action === 'picked_up') {
    // Also after a "No show": the monitor turned up after all. The no-show stays on record.
    if (!stop.picked_up_at) {
      stop = (await pool.query('UPDATE monitor_stops SET picked_up_at = now(), escalate_at = NULL WHERE id = $1 RETURNING *', [stop.id])).rows[0];
      await logEvent(stop.id, 'picked_up', req.auth.userId);
      await safely('cancel escalation', () => cancelEscalation(req.auth.tenantId, stop.id));
    }
  } else if (action === 'no_show') {
    if (stop.picked_up_at) throw new HttpError(409, 'the monitor is already picked up');
    if (!stop.no_show_at) {
      stop = (await pool.query('UPDATE monitor_stops SET no_show_at = now(), escalate_at = NULL WHERE id = $1 RETURNING *', [stop.id])).rows[0];
      await logEvent(stop.id, 'no_show', req.auth.userId);
      await safely('cancel escalation', () => cancelEscalation(req.auth.tenantId, stop.id));
      // Right away, no waiting. The driver carries on with the students regardless.
      await notifyAdmins(
        req.auth.tenantId,
        `Monitor no show: ${ride.monitor_name}`,
        `${tripText(ride)}: ${ride.driver_name} marked ${ride.monitor_name} as a no show. The run continues without the monitor.`,
        alertData(ride, 'no_show')
      );
    }
  } else if (action === 'dropped_off') {
    if (stop.no_show_at && !stop.picked_up_at) throw new HttpError(409, 'the monitor was marked as a no show');
    if (!stop.dropped_off_at) {
      stop = (await pool.query('UPDATE monitor_stops SET dropped_off_at = now() WHERE id = $1 RETURNING *', [stop.id])).rows[0];
      await logEvent(stop.id, 'dropped_off', req.auth.userId);
    }
  }
  return publicStop(stop);
}

// POST /monitor/running-late { shift_period } (the monitor, today's run with their driver).
async function monitorRunningLate(req, body = {}) {
  const shift = body.shift_period;
  assertShift(shift);
  const ride = await rideToday(req, { monitorId: req.auth.userId, shift });
  if (!ride) throw new HttpError(404, `you are not riding the ${shift} run today`);
  const stop = await upsertStop(req, ride);
  return publicStop(await reportLate(req, ride, stop, 'monitor'));
}

// Today's stop rows, keyed `${monitorId}:${shift}`, for the screens.
async function stopsForDay(companyId, { driverId = null, monitorId = null }, date) {
  const { rows } = await pool.query(
    `SELECT * FROM monitor_stops WHERE company_id = $1 AND run_date = $2::date
        AND ($3::uuid IS NULL OR driver_user_id = $3) AND ($4::uuid IS NULL OR monitor_user_id = $4)`,
    [companyId, date, driverId, monitorId]
  );
  return new Map(rows.map((r) => [`${r.monitor_user_id}:${r.shift_period}`, r]));
}

module.exports = { driverStopAction, monitorRunningLate, stopsForDay, publicStop, stopStatus };
