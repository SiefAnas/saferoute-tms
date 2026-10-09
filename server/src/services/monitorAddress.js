// A monitor's home address (migration 034): street_address, city, state, zip_code on users, the
// same four fields and rules as a student's address (routes/students.js), so the apps show and copy
// it the same way. The driver picks the monitor up there before the first student stop.
//
// Only monitors have one. The four go together: a body that sends any of them sends all four,
// either all filled in (saved) or all null / empty (address removed). Half an address would put
// the driver at a street with no city.
const { HttpError } = require('../errors');
const { assertValidState, assertValidZip, assertMaxLength } = require('../validate');
const { formatAddress } = require('./stops');

const ADDRESS_KEYS = ['street_address', 'city', 'state', 'zip_code'];

// `names` maps each column to the body key it comes from (createUser takes camelCase).
// Returns the columns to write, or null when the body has none of them.
function readMonitorAddress(body, role, names = { street_address: 'street_address', city: 'city', state: 'state', zip_code: 'zip_code' }) {
  const given = ADDRESS_KEYS.filter((k) => body[names[k]] !== undefined);
  if (given.length === 0) return null;
  if (role !== 'monitor') throw new HttpError(400, 'only a monitor has a street address, city, state and zip code here');
  const keyList = ADDRESS_KEYS.map((k) => names[k]).join(', ');
  if (given.length !== ADDRESS_KEYS.length) throw new HttpError(400, `${keyList} go together: send all four`);

  const values = {};
  for (const k of ADDRESS_KEYS) {
    const v = body[names[k]];
    if (v !== null && typeof v !== 'string') throw new HttpError(400, `${names[k]} must be text`);
    values[k] = typeof v === 'string' ? v.trim() || null : null;
  }
  const filled = ADDRESS_KEYS.filter((k) => values[k] !== null).length;
  if (filled === 0) return values; // removing the address
  if (filled !== ADDRESS_KEYS.length) throw new HttpError(400, `${keyList} are all required for an address`);
  assertMaxLength(values.street_address, 300, names.street_address);
  assertMaxLength(values.city, 100, names.city);
  assertValidZip(values.zip_code, names.zip_code);
  values.state = assertValidState(values.state, names.state);
  return values;
}

// "12 Oak St, Boston, MA 02139", or null without an address.
function monitorAddressLine(u) {
  return u.street_address ? formatAddress(u.street_address, u.city, u.state, u.zip_code) : null;
}

module.exports = { ADDRESS_KEYS, readMonitorAddress, monitorAddressLine };
