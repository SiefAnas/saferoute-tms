// Where each run starts and ends, in one place (branch stops-and-extra-addresses).
//
//   Morning:   pick up at home      → drop off at school
//   Afternoon: pick up at school    → drop off at home
//
// "Home" is the student's address, unless an extra address (student_extra_addresses) applies to
// that day and leg: its weekdays include the day, the day is inside its optional start/end
// dates, and it covers the leg (morning_pickup, afternoon_dropoff or both). If several apply,
// the most recently created one wins. The server decides; the apps only show `route`.
const pool = require('../db/pool');
const { HttpError } = require('../errors');
const { normalizeWeekdays, assertValidState, assertValidZip, assertMaxLength } = require('../validate');

const APPLIES_TO = ['morning_pickup', 'afternoon_dropoff', 'both'];

// LEFT JOIN LATERAL picking the extra address for student `st` on `day` (a SQL date expression)
// for one leg. `alias` names the joined columns (e.g. xm_label, xm_street_address ...).
function extraAddressJoinSql(day, alias, leg) {
  const legs = leg === 'morning' ? "('morning_pickup', 'both')" : "('afternoon_dropoff', 'both')";
  return `LEFT JOIN LATERAL (
         SELECT x.label, x.street_address, x.city, x.state, x.zip_code
           FROM student_extra_addresses x
          WHERE x.student_id = st.id
            AND EXTRACT(ISODOW FROM ${day})::smallint = ANY(x.days_of_week)
            AND (x.start_date IS NULL OR x.start_date <= ${day})
            AND (x.end_date IS NULL OR x.end_date >= ${day})
            AND x.applies_to IN ${legs}
          ORDER BY x.created_at DESC
          LIMIT 1
       ) ${alias} ON true`;
}

// Both legs' joins, for queries that alias students as `st`.
function routeJoinsSql(day) {
  return `${extraAddressJoinSql(day, 'xm', 'morning')}\n       ${extraAddressJoinSql(day, 'xa', 'afternoon')}`;
}

// Columns route() needs (students `st`, schools `sc`, the two laterals).
const ROUTE_COLUMNS = `st.street_address AS home_street, st.city AS home_city, st.state AS home_state, st.zip_code AS home_zip,
            sc.name AS route_school_name, sc.address AS school_address, sc.state AS school_state, sc.zip_code AS school_zip,
            xm.label AS xm_label, xm.street_address AS xm_street, xm.city AS xm_city, xm.state AS xm_state, xm.zip_code AS xm_zip,
            xa.label AS xa_label, xa.street_address AS xa_street, xa.city AS xa_city, xa.state AS xa_state, xa.zip_code AS xa_zip`;

// "12 Oak St, Boston, MA 02139" (missing parts left out).
function formatAddress(street, city, state, zip) {
  const tail = [state, zip].filter(Boolean).join(' ');
  return [street, city, tail].filter(Boolean).join(', ') || null;
}

// Place: { kind: 'home' | 'school' | 'extra', label, address }. kind 'extra' is the one the apps
// highlight ("Different address today: Grandparents").
function homePlace(r, prefix) {
  if (r[`${prefix}_label`]) {
    return {
      kind: 'extra',
      label: r[`${prefix}_label`],
      address: formatAddress(r[`${prefix}_street`], r[`${prefix}_city`], r[`${prefix}_state`], r[`${prefix}_zip`]),
    };
  }
  return { kind: 'home', label: 'Home', address: formatAddress(r.home_street, r.home_city, r.home_state, r.home_zip) };
}

// route for one assignment row: { morning: {from, to} | null, afternoon: {from, to} | null },
// only the legs its shift_period covers.
function route(r) {
  const school = { kind: 'school', label: r.route_school_name, address: formatAddress(r.school_address, null, r.school_state, r.school_zip) };
  return {
    morning: r.shift_period !== 'afternoon' ? { from: homePlace(r, 'xm'), to: school } : null,
    afternoon: r.shift_period !== 'morning' ? { from: school, to: homePlace(r, 'xa') } : null,
  };
}

// ---- Extra address records (admin CRUD) ----

function assertIsoDate(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${field} must be a date in YYYY-MM-DD format`);
  }
  return value;
}

// Validates a create (full) or patch (partial) body into DB columns.
function extraAddressFields(body = {}, { partial = false } = {}) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has('label')) {
    if (!body.label || typeof body.label !== 'string') throw new HttpError(400, 'label is required (e.g. "Grandparents")');
    assertMaxLength(body.label, 100, 'label');
    out.label = body.label.trim();
  }
  if (!partial || has('street_address')) {
    if (!body.street_address) throw new HttpError(400, 'street_address is required');
    assertMaxLength(body.street_address, 300, 'street_address');
    out.street_address = body.street_address;
  }
  if (has('city')) {
    assertMaxLength(body.city, 100, 'city');
    out.city = body.city || null;
  }
  if (has('state')) out.state = body.state ? assertValidState(body.state) : null;
  if (has('zip_code')) {
    if (body.zip_code) assertValidZip(body.zip_code, 'zip_code');
    out.zip_code = body.zip_code || null;
  }
  if (!partial || has('days_of_week')) {
    const days = normalizeWeekdays(body.days_of_week);
    if (!days) throw new HttpError(400, 'days_of_week is required (1 = Monday ... 7 = Sunday)');
    out.days_of_week = days;
  }
  if (!partial || has('applies_to')) {
    if (!APPLIES_TO.includes(body.applies_to)) {
      throw new HttpError(400, `applies_to must be one of: ${APPLIES_TO.join(', ')}`);
    }
    out.applies_to = body.applies_to;
  }
  if (has('start_date')) out.start_date = assertIsoDate(body.start_date, 'start_date');
  if (has('end_date')) out.end_date = assertIsoDate(body.end_date, 'end_date');
  return out;
}

// API shape of a record (dates as calendar strings, never through a JS Date).
function publicExtraAddress(x) {
  const day = (d) => (d == null ? null : typeof d === 'string' ? d.slice(0, 10) : null);
  return {
    id: x.id,
    student_id: x.student_id,
    label: x.label,
    street_address: x.street_address,
    city: x.city,
    state: x.state,
    zip_code: x.zip_code,
    address: formatAddress(x.street_address, x.city, x.state, x.zip_code),
    days_of_week: x.days_of_week,
    applies_to: x.applies_to,
    start_date: day(x.start_date_text ?? x.start_date),
    end_date: day(x.end_date_text ?? x.end_date),
  };
}

// Record reads/writes use plain SQL so the dates come back as ::text (calendar strings). Every
// query carries the company id, and callers check the student is in their scope first.
const EXTRA_COLUMNS = `id, student_id, label, street_address, city, state, zip_code, days_of_week, applies_to,
            start_date::text AS start_date_text, end_date::text AS end_date_text`;

async function listExtraAddresses(companyId, studentId) {
  const { rows } = await pool.query(
    `SELECT ${EXTRA_COLUMNS} FROM student_extra_addresses WHERE company_id = $1 AND student_id = $2 ORDER BY created_at`,
    [companyId, studentId]
  );
  return rows.map(publicExtraAddress);
}

function mapDbError(err) {
  if (err.code === '23514' && String(err.constraint).includes('dates')) return new HttpError(400, 'end_date must be on or after start_date');
  return err;
}

async function createExtraAddress(companyId, studentId, body) {
  const f = extraAddressFields(body);
  const cols = ['company_id', 'student_id', ...Object.keys(f)];
  const vals = [companyId, studentId, ...Object.values(f)];
  try {
    const { rows } = await pool.query(
      `INSERT INTO student_extra_addresses (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING ${EXTRA_COLUMNS}`,
      vals
    );
    return publicExtraAddress(rows[0]);
  } catch (err) {
    throw mapDbError(err);
  }
}

async function updateExtraAddress(companyId, studentId, id, body) {
  const f = extraAddressFields(body, { partial: true });
  const keys = Object.keys(f);
  if (keys.length === 0) throw new HttpError(400, 'nothing to update');
  try {
    const { rows } = await pool.query(
      `UPDATE student_extra_addresses SET ${keys.map((k, i) => `${k} = $${i + 4}`).join(', ')}
        WHERE id = $1 AND student_id = $2 AND company_id = $3 RETURNING ${EXTRA_COLUMNS}`,
      [id, studentId, companyId, ...Object.values(f)]
    );
    if (!rows[0]) throw new HttpError(404, 'address not found');
    return publicExtraAddress(rows[0]);
  } catch (err) {
    throw mapDbError(err);
  }
}

async function deleteExtraAddress(companyId, studentId, id) {
  const { rowCount } = await pool.query('DELETE FROM student_extra_addresses WHERE id = $1 AND student_id = $2 AND company_id = $3', [id, studentId, companyId]);
  if (!rowCount) throw new HttpError(404, 'address not found');
}

module.exports = {
  routeJoinsSql, ROUTE_COLUMNS, route, formatAddress, publicExtraAddress, APPLIES_TO,
  listExtraAddresses, createExtraAddress, updateExtraAddress, deleteExtraAddress,
};
