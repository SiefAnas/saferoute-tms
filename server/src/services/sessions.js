// Driver shift sessions (§7.1). A driver checks in (starts a shift) and checks out (ends it,
// auto-calculating hours). company_admin can read all company sessions; a driver only their own.
const { HttpError } = require('../errors');
const { ownerScope } = require('../middleware/authorize');
const { withTx } = require('../db/tx');

// GPS is optional at MVP; when present it must be a sane lat/lng pair.
function gps(body, prefix) {
  const lat = body[`${prefix}_lat`];
  const lng = body[`${prefix}_lng`];
  if (lat === undefined && lng === undefined) return {};
  if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpError(400, 'invalid GPS coordinates');
  }
  return { [`${prefix}_lat`]: lat, [`${prefix}_lng`]: lng };
}

// Who checks in and out for their hours: drivers, and monitors riding with them (monitor-role).
const CLOCKS_IN = ['driver', 'monitor'];

const SHIFT_LABEL = { morning: 'Morning', afternoon: 'Afternoon' };
const labelOf = (period) => SHIFT_LABEL[period] || 'a shift';

// A driver is checked into at most ONE shift at a time, across both periods. Switching to
// the other shift is allowed, but only with confirm_switch: true (the client shows a warning
// first); the old shift is checked out in the same transaction, so there is never a moment
// with two open sessions. A shift that already has a session today (finished, or closed by
// a switch) can't be checked into again, so the driver can't go back to it. "Today" is the
// UTC date of check_in_at, the same day key payroll uses to group sessions.
async function checkIn(req, body = {}) {
  if (!CLOCKS_IN.includes(req.auth.role)) throw new HttpError(403, 'only drivers and monitors check in');
  const { shift_period, confirm_switch } = body;
  if (!['morning', 'afternoon'].includes(shift_period)) {
    throw new HttpError(400, "shift_period must be 'morning' or 'afternoon'");
  }
  const coords = gps(body, 'check_in');
  const { userId, tenantId } = req.auth;

  return withTx(async (client) => {
    // Serialize this driver's check-ins so two simultaneous requests can't both see
    // "nothing open" and each open a session.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    const { rows: open } = await client.query(
      'SELECT id, shift_period FROM sessions WHERE user_id = $1 AND company_id = $2 AND check_out_at IS NULL',
      [userId, tenantId]
    );
    if (open.some((s) => s.shift_period === shift_period)) {
      throw new HttpError(409, `you are already checked into ${labelOf(shift_period)}`);
    }

    // Hard block on returning to a finished shift. Kept for now as a deliberate choice under
    // review: decide based on real driver feedback during beta testing whether this should be
    // relaxed to a warning-only version instead.
    const { rows: already } = await client.query(
      `SELECT 1 FROM sessions
        WHERE user_id = $1 AND company_id = $2 AND shift_period = $3
          AND check_in_at::date = CURRENT_DATE
        LIMIT 1`,
      [userId, tenantId, shift_period]
    );
    if (already.length > 0) {
      throw new HttpError(409, `you already worked the ${labelOf(shift_period)} shift today and cannot return to it`);
    }

    if (open.length > 0) {
      if (confirm_switch !== true) {
        throw new HttpError(
          409,
          `you are currently checked into ${labelOf(open[0].shift_period)}; confirm to switch to ${labelOf(shift_period)}`
        );
      }
      await client.query(
        `UPDATE sessions
            SET check_out_at = now(),
                duration_minutes = round(extract(epoch from (now() - check_in_at)) / 60)::int
          WHERE user_id = $1 AND company_id = $2 AND check_out_at IS NULL`,
        [userId, tenantId]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO sessions (user_id, company_id, shift_period, check_in_lat, check_in_lng)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, tenantId, shift_period, coords.check_in_lat ?? null, coords.check_in_lng ?? null]
    );
    return rows[0];
  });
}

async function checkOut(req, id, body = {}) {
  if (!CLOCKS_IN.includes(req.auth.role)) throw new HttpError(403, 'only drivers and monitors check out');
  const session = await req.db.findById('sessions', id, {
    owner: { column: 'user_id', value: req.auth.userId },
  });
  if (!session) throw new HttpError(404, 'session not found');
  if (session.check_out_at) throw new HttpError(409, 'shift already checked out');

  const checkOutAt = new Date();
  const durationMinutes = Math.round((checkOutAt - new Date(session.check_in_at)) / 60000);
  return req.db.update(
    'sessions',
    id,
    { check_out_at: checkOutAt.toISOString(), duration_minutes: durationMinutes, ...gps(body, 'check_out') },
    { owner: { column: 'user_id', value: req.auth.userId } }
  );
}

async function listSessions(req) {
  // company_admin -> all company shifts; driver -> own only (owner sub-scope).
  return req.db.findMany('sessions', { owner: ownerScope(req, 'sessions'), orderBy: 'check_in_at' });
}

async function getSession(req, id) {
  const row = await req.db.findById('sessions', id, { owner: ownerScope(req, 'sessions') });
  if (!row) throw new HttpError(404, 'session not found');
  return row;
}

module.exports = { checkIn, checkOut, listSessions, getSession };
