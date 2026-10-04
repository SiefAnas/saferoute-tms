// The server's "now" for business decisions (branch company-timezone). Everything that decides a
// company's date or local time asks this instead of calling `new Date()` itself, so tests can pin
// the clock to the exact edges (11:30pm, a DST change, a skip cutoff) through the real HTTP API.
// Audit timestamps (created_at, last_login_at …) still come from the database's now().
let pinned = null;

function now() {
  return pinned ? new Date(pinned.getTime()) : new Date();
}

// Test hook: pin the clock to an instant (Date or ISO string); `null` goes back to the real clock.
function _pin(instant) {
  if (process.env.NODE_ENV !== 'test') throw new Error('clock._pin is for tests only');
  pinned = instant == null ? null : new Date(instant);
}

module.exports = { now, _pin };
