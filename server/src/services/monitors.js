// Monitors (branch monitor-role). A monitor rides in the van with one driver and checks in and out
// for their hours. They see only their own shifts and pay, plus the driver's name and phone and the
// van: never any student data (the student/trip/van/assignment routers deny the role outright).
//
// The company admin creates monitors through POST /users (role 'monitor', temporary password like
// drivers) and assigns each one to a driver here, with the weekdays and the shift they ride.
const pool = require('../db/pool');
const { HttpError } = require('../errors');
const { assignmentNotEndedSql, assignmentRunsOnSql } = require('../db/scoped');

const SHIFTS = ['morning', 'afternoon', 'both'];

function validDays(days) {
  return Array.isArray(days) && days.length > 0 && days.length <= 7 &&
    days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) && new Set(days).size === days.length;
}

function publicAssignment(r) {
  if (!r || !r.assignment_id) return null;
  return {
    id: r.assignment_id,
    driver_user_id: r.driver_user_id,
    driver_name: r.driver_name,
    driver_phone: r.driver_phone ?? null,
    days_of_week: r.days_of_week.map(Number).sort((a, b) => a - b),
    shift_period: r.shift_period,
  };
}

function openSession(r) {
  if (!r || !r.open_session_id) return null;
  return { id: r.open_session_id, shift_period: r.open_shift_period, check_in_at: r.open_check_in_at };
}

// Every monitor in the company, with their driver assignment and whether they're checked in now.
// Used by the Monitors page, the dashboard ("who's on shift") and payroll (grouped by driver).
async function listMonitors(req) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.phone, u.is_active, u.created_by_user_id, u.must_change_password,
            ma.id AS assignment_id, ma.driver_user_id, ma.days_of_week, ma.shift_period,
            d.full_name AS driver_name, d.phone AS driver_phone,
            s.id AS open_session_id, s.shift_period AS open_shift_period, s.check_in_at AS open_check_in_at
       FROM users u
       LEFT JOIN monitor_assignments ma ON ma.monitor_user_id = u.id AND ma.company_id = u.company_id
       LEFT JOIN users d ON d.id = ma.driver_user_id AND d.company_id = u.company_id
       LEFT JOIN LATERAL (
         SELECT id, shift_period, check_in_at FROM sessions
          WHERE user_id = u.id AND company_id = u.company_id AND check_out_at IS NULL
          ORDER BY check_in_at DESC LIMIT 1
       ) s ON true
      WHERE u.company_id = $1 AND u.role = 'monitor'
      ORDER BY u.full_name`,
    [req.auth.tenantId]
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    full_name: r.full_name,
    role: 'monitor',
    phone: r.phone,
    is_active: r.is_active,
    created_by_user_id: r.created_by_user_id ?? null,
    must_change_password: Boolean(r.must_change_password),
    assignment: publicAssignment(r),
    open_session: openSession(r),
  }));
}

async function findCompanyUser(req, id, role) {
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE id::text = $1 AND company_id = $2 AND role = $3',
    [String(id), req.auth.tenantId, role]
  );
  return rows[0] ?? null;
}

// PUT /monitors/:id/assignment { driver_user_id, days_of_week?, shift_period? }: one driver per
// monitor; saving again replaces it. A monitor or driver outside the company reads as not found.
async function setAssignment(req, monitorId, body = {}) {
  const { driver_user_id } = body;
  const days = body.days_of_week ?? [1, 2, 3, 4, 5];
  const shift = body.shift_period ?? 'both';
  if (!(await findCompanyUser(req, monitorId, 'monitor'))) throw new HttpError(404, 'monitor not found');
  if (!driver_user_id) throw new HttpError(400, 'driver_user_id is required');
  if (!validDays(days)) throw new HttpError(400, 'days_of_week must be a list of weekdays 1-7 (1 = Monday)');
  if (!SHIFTS.includes(shift)) throw new HttpError(400, "shift_period must be 'morning', 'afternoon' or 'both'");
  if (!(await findCompanyUser(req, driver_user_id, 'driver'))) throw new HttpError(404, 'driver not found');

  await pool.query(
    `INSERT INTO monitor_assignments (company_id, monitor_user_id, driver_user_id, days_of_week, shift_period)
     VALUES ($1, $2, $3, $4::smallint[], $5)
     ON CONFLICT (monitor_user_id) DO UPDATE
       SET driver_user_id = EXCLUDED.driver_user_id, days_of_week = EXCLUDED.days_of_week,
           shift_period = EXCLUDED.shift_period`,
    [req.auth.tenantId, monitorId, driver_user_id, days, shift]
  );
  return (await listMonitors(req)).find((m) => m.id === monitorId);
}

async function removeAssignment(req, monitorId) {
  if (!(await findCompanyUser(req, monitorId, 'monitor'))) throw new HttpError(404, 'monitor not found');
  await pool.query('DELETE FROM monitor_assignments WHERE monitor_user_id = $1 AND company_id = $2', [monitorId, req.auth.tenantId]);
}

// GET /monitor/me: what a monitor's own screen needs. The driver's name and phone (to call them),
// the van the driver is on (from the driver's current assignments: running today first, else the
// next one), the weekdays and shift they ride, and their shifts today. No students, by design.
async function monitorHome(req) {
  const { userId, tenantId } = req.auth;
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name,
            ma.id AS assignment_id, ma.driver_user_id, ma.days_of_week, ma.shift_period,
            d.full_name AS driver_name, d.phone AS driver_phone
       FROM users u
       LEFT JOIN monitor_assignments ma ON ma.monitor_user_id = u.id AND ma.company_id = u.company_id
       LEFT JOIN users d ON d.id = ma.driver_user_id AND d.company_id = u.company_id
      WHERE u.id = $1 AND u.company_id = $2`,
    [userId, tenantId]
  );
  const me = rows[0];
  if (!me) throw new HttpError(404, 'not found');
  const assignment = publicAssignment(me);

  let van = null;
  if (assignment) {
    const { rows: vans } = await pool.query(
      `SELECT v.id, v.number, v.license_plate, v.brand, v.model, v.color,
              bool_or(${assignmentRunsOnSql('a', 'CURRENT_DATE')} AND a.start_date <= CURRENT_DATE) AS today,
              COUNT(*)::int AS runs
         FROM assignments a JOIN vans v ON v.id = a.van_id AND v.company_id = a.company_id
        WHERE a.driver_user_id = $1 AND a.company_id = $2 AND ${assignmentNotEndedSql('a')}
        GROUP BY v.id
        ORDER BY today DESC, runs DESC
        LIMIT 1`,
      [assignment.driver_user_id, tenantId]
    );
    if (vans[0]) {
      const { today, runs, ...rest } = vans[0];
      van = rest;
    }
  }

  const [{ rows: open }, { rows: todays }] = await Promise.all([
    pool.query(
      `SELECT id, shift_period, check_in_at FROM sessions
        WHERE user_id = $1 AND company_id = $2 AND check_out_at IS NULL
        ORDER BY check_in_at DESC LIMIT 1`,
      [userId, tenantId]
    ),
    pool.query(
      `SELECT id, shift_period, check_in_at, check_out_at, duration_minutes FROM sessions
        WHERE user_id = $1 AND company_id = $2 AND check_in_at::date = CURRENT_DATE
        ORDER BY check_in_at`,
      [userId, tenantId]
    ),
  ]);

  return {
    monitor: { id: me.id, full_name: me.full_name },
    assignment: assignment && { days_of_week: assignment.days_of_week, shift_period: assignment.shift_period },
    driver: assignment && { full_name: assignment.driver_name, phone: assignment.driver_phone },
    van,
    open_session: open[0] ?? null,
    today_sessions: todays,
  };
}

module.exports = { listMonitors, setAssignment, removeAssignment, monitorHome };
