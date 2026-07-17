// Driver shift sessions (§7.1). A driver checks in (starts a shift) and checks out (ends it,
// auto-calculating hours). company_admin can read all company sessions; a driver only their own.
const { HttpError } = require('../errors');
const { ownerScope } = require('../middleware/authorize');

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

async function checkIn(req, body = {}) {
  if (req.auth.role !== 'driver') throw new HttpError(403, 'only drivers check in');
  // One open shift at a time.
  const open = await req.db.findMany('sessions', {
    owner: { column: 'user_id', value: req.auth.userId },
    where: {}, // check_out_at IS NULL filtered below
  });
  if (open.some((s) => s.check_out_at === null)) {
    throw new HttpError(409, 'you already have an open shift; check out first');
  }
  return req.db.insert('sessions', { user_id: req.auth.userId, ...gps(body, 'check_in') });
}

async function checkOut(req, id, body = {}) {
  if (req.auth.role !== 'driver') throw new HttpError(403, 'only drivers check out');
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
