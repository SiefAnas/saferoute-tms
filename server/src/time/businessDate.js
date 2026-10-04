// A company's business date and local time (branch company-timezone).
//
// Each company has a timezone (companies.timezone, an IANA name, default America/New_York). It
// decides which day is "today" for that company, when a parent's skip cutoff passes, and which day
// payroll counts a shift in. Everything here uses the platform's own Intl timezone support; no
// date library. The database's session timezone is never consulted: callers pass the dates and
// instants computed here into their SQL as parameters.
//
// Every function takes an optional `now` (a Date) so tests can pin the clock; by default it is the
// server clock (time/clock.js).
const clock = require('./clock');

const DEFAULT_TIME_ZONE = 'America/New_York';
// "Area/Location" or "Area/Location/Sub" IANA names, or UTC. Offsets like "+05:00" and
// abbreviations like "EST" are refused even where Intl would accept them.
const ZONE_NAME = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;

const formatters = new Map();
function formatterFor(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

// The wall-clock reading in `timeZone` at `instant`: { year, month, day, hour, minute, second }.
function zonedParts(instant, timeZone) {
  const out = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(instant)) {
    if (type !== 'literal' && type !== 'dayPeriod') out[type] = Number(value);
  }
  if (out.hour === 24) out.hour = 0; // some engines print midnight as 24 even with h23
  return out;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const isoDate = (p) => `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;

// 'YYYY-MM-DD' of `instant` in `timeZone`.
function dateInZone(timeZone, instant = clock.now()) {
  return isoDate(zonedParts(instant, timeZone));
}

// The current moment in `timeZone`: the instant plus its local date and wall-clock time.
function nowInZone(timeZone, instant = clock.now()) {
  const p = zonedParts(instant, timeZone);
  return {
    timeZone,
    instant,
    date: isoDate(p),
    time: `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`,
    minutesOfDay: p.hour * 60 + p.minute,
  };
}

// Calendar arithmetic on 'YYYY-MM-DD' strings, no timezone involved.
function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// The instant the local day `date` begins in `timeZone` (local midnight; on the rare zone where a
// DST change skips midnight, the first instant of that date). Payroll periods are [start of
// `from`, start of `to`) in the company's zone.
function startOfDay(date, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const shownAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const next = target - (shownAsUtc - guess);
    if (next === guess) break;
    guess = next;
  }
  // Midnight didn't exist (DST gap at 00:00): step forward to the first instant on that date.
  while (dateInZone(timeZone, new Date(guess)) < date) guess += 15 * 60 * 1000;
  return new Date(guess);
}

// [start, end) instants of the local day `date` in `timeZone`, for "check_in_at is on that day"
// (23, 24 or 25 hours long, depending on DST).
function dayRange(date, timeZone) {
  return { start: startOfDay(date, timeZone), end: startOfDay(addDays(date, 1), timeZone) };
}

// 'HH:MM[:SS]' -> minutes after local midnight.
function minutesOfTime(time) {
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
}

// ---- companies ------------------------------------------------------------------------------

async function companyTimeZone(companyOrId) {
  if (companyOrId && typeof companyOrId === 'object') return companyOrId.timezone ?? DEFAULT_TIME_ZONE;
  const pool = require('../db/pool');
  const { rows } = await pool.query('SELECT timezone FROM companies WHERE id = $1', [companyOrId]);
  if (!rows[0]) throw new Error(`company ${companyOrId} not found`);
  return rows[0].timezone;
}

// The company's business date ('YYYY-MM-DD'), given its id or the company row already loaded.
async function businessDateFor(companyOrId, now = clock.now()) {
  return dateInZone(await companyTimeZone(companyOrId), now);
}

// The current moment in the company's zone (see nowInZone).
async function businessNowFor(companyOrId, now = clock.now()) {
  return nowInZone(await companyTimeZone(companyOrId), now);
}

// ---- validation -----------------------------------------------------------------------------

// Well-formed, and known to Intl. (Node's own list, Intl.supportedValuesOf('timeZone'), uses ICU's
// canonical names: it has Asia/Calcutta but not today's Asia/Kolkata, and no UTC, so it isn't used
// as the gate; Intl accepting the name is.)
function isValidTimeZone(name) {
  if (typeof name !== 'string' || !ZONE_NAME.test(name)) return false;
  try {
    formatterFor(name);
    return true;
  } catch {
    return false;
  }
}

// Every zone we store must also be one Postgres knows (school-side queries convert with
// AT TIME ZONE per row). Returns true/false.
async function isKnownToDatabase(name, db) {
  const { rows } = await db.query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [name]);
  return rows.length > 0;
}

module.exports = {
  DEFAULT_TIME_ZONE, zonedParts, dateInZone, nowInZone, addDays, startOfDay, dayRange, minutesOfTime,
  companyTimeZone, businessDateFor, businessNowFor, isValidTimeZone, isKnownToDatabase,
};
