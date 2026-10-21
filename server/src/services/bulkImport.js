// Bulk import (docs/bulk-import-spec.md). The website reads the spreadsheet and maps its columns;
// the server gets plain rows keyed by SafeTurns field names and does all the checking, so a
// direct API call gets exactly the same rules as the import screen.
//
//   preview(req, type, rows) -> what each row would do; writes nothing.
//   commit(req, type, rows)  -> plans again (never trusts an earlier preview), then imports the
//                               good rows, each in its own transaction. Bad rows are not imported.
//
// Never deactivates anything: a record missing from the file is left alone.
// Never renames or merges duplicates: two rows for one email / plate / student are both errors.
const pool = require('../db/pool');
const { withTx } = require('../db/tx');
const { HttpError } = require('../errors');
const { hashPassword } = require('../auth/password');
const { assertValidEmail, assertValidZip, assertValidState } = require('../validate');
const { TEMP_PASSWORD_DAYS, generateTempPassword } = require('./passwords');
const { listCompanySchools } = require('./schools');
const { createBuiltins } = require('./fleet');
const { createScopedDb } = require('../db/scoped');
const { rangesOverlap, shiftsOverlap, daysOverlap, assertNoConflicts } = require('./assignmentConflicts');
const { normalizeSchedule, assertActiveDriver, assertAssignable } = require('./assignmentRules');
const { businessDateFor } = require('../time/businessDate');

const MAX_ROWS = 100;
const MAX_CELL = 500;
// Random 12-character temporary passwords that must be replaced at first login: a cheaper bcrypt
// cost keeps a 100-row import to a few seconds without weakening anything that matters.
const TEMP_HASH_ROUNDS = 10;

const f = (key, label, required = false) => ({ key, label, required });

// `required` marks what a NEW record needs; an update only checks the fields that are present.
const TYPES = {
  // Schools come first (spec section 6): students need a school to import against. The schools
  // table has no city column, so street and city both go in Address.
  schools: {
    label: 'Schools', side: 'company', key: 'name',
    fields: [f('name', 'School name', true), f('address', 'Address', true), f('state', 'State (2 letters)'), f('zip_code', 'Zip code'), f('phone', 'Phone'), f('hours', 'Hours'), f('website', 'Website')],
  },
  drivers: { label: 'Drivers', side: 'company', role: 'driver', key: 'email', fields: [f('full_name', 'Full name', true), f('email', 'Email', true), f('phone', 'Phone'), f('address', 'Address'), f('license_number', 'License number')] },
  monitors: { label: 'Monitors', side: 'company', role: 'monitor', key: 'email', fields: [f('full_name', 'Full name', true), f('email', 'Email', true), f('phone', 'Phone'), f('address', 'Address')] },
  parents: { label: 'Parents', side: 'company', role: 'parent', key: 'email', fields: [f('full_name', 'Full name', true), f('email', 'Email', true), f('phone', 'Phone', true), f('address', 'Address', true)] },
  vans: { label: 'Vans', side: 'company', key: 'license_plate', fields: [f('license_plate', 'License plate', true), f('brand', 'Brand', true), f('model', 'Model', true), f('year', 'Year', true), f('color', 'Color', true), f('number', 'Van number')] },
  students: {
    label: 'Students', side: 'company', key: 'Student ID + school (else name + school)',
    fields: [f('full_name', 'Student name', true), f('school', 'School (exact name)', true), f('student_id', 'Student ID'), f('grade', 'Grade', true), f('age', 'Age', true), f('parent_name', 'Parent name', true), f('parent_phone', 'Parent phone', true), f('parent_email', 'Parent email'), f('street_address', 'Street address', true), f('city', 'City', true), f('state', 'State (2 letters)', true), f('zip_code', 'Zip code', true), f('notes', 'Notes')],
  },
  // Last (spec section 6): ties students to a driver and a van, so those must exist first.
  assignments: {
    label: 'Assignments', side: 'company', key: 'student + school',
    fields: [
      f('student_name', 'Student name', true), f('school', 'School (exact name)', true), f('student_id', 'Student ID'),
      f('driver_email', 'Driver email', true), f('van_plate', 'Van license plate', true),
      f('start_date', 'Start date', true), f('end_date', 'End date'), f('pickup_time', 'Pickup time'), f('dropoff_time', 'Dropoff time'),
      f('shift_period', 'Shift (morning/afternoon/both)'), f('days_of_week', 'Days'),
    ],
  },
  staff: { label: 'School staff', side: 'school', role: 'school_staff', key: 'email', fields: [f('full_name', 'Full name', true), f('email', 'Email', true), f('phone', 'Phone')] },
};

const TYPES_BY_ROLE = {
  company_admin: ['schools', 'drivers', 'monitors', 'parents', 'vans', 'students', 'assignments'],
  school_admin: ['staff'],
};

function typesFor(role) {
  return (TYPES_BY_ROLE[role] ?? []).map((id) => ({ id, label: TYPES[id].label, match_key: TYPES[id].key, fields: TYPES[id].fields }));
}

function assertCanImport(req, type) {
  const def = TYPES[type];
  if (!def) throw new HttpError(400, 'choose what you are importing: schools, drivers, monitors, parents, vans, students, assignments or staff');
  if (!(TYPES_BY_ROLE[req.auth.role] ?? []).includes(type)) {
    throw new HttpError(403, `your role cannot import ${def.label.toLowerCase()}`);
  }
  return def;
}

// Every value becomes trimmed text. Only the mapped SafeTurns fields are kept.
function normalizeRows(def, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new HttpError(400, 'The file has no rows to import. Check that it has a header row and at least one row of data.');
  }
  if (rows.length > MAX_ROWS) {
    throw new HttpError(400, `This file has ${rows.length} rows. The limit is ${MAX_ROWS} per file. Split it into smaller files and upload them one at a time.`);
  }
  return rows.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, `row ${i + 1} is not an object of field values`);
    const out = {};
    for (const { key } of def.fields) {
      const v = raw[key];
      out[key] = v === undefined || v === null ? '' : String(v).trim();
    }
    return out;
  });
}

const tooLong = (row, max = MAX_CELL) => Object.entries(row).find(([, v]) => v.length > max)?.[0];
const lc = (s) => String(s).toLowerCase();

function missingRequired(def, row) {
  return def.fields.filter((fd) => fd.required && !row[fd.key]).map((fd) => fd.label);
}

// Marks every row that shares a key with another row of the file as an error.
function flagDuplicates(plans, keyOf, what) {
  const groups = new Map();
  plans.forEach((p, i) => {
    const k = keyOf(p, i);
    if (!k) return;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    for (const i of idxs) {
      plans[i].action = 'error';
      plans[i].reason = `Duplicate ${what}: ${idxs.length} rows in this file have it. Each row needs its own.`;
    }
  }
}

const err = (plan, reason) => Object.assign(plan, { action: 'error', reason });

// ---- people (drivers, monitors, parents, staff) -------------------------------------------------

async function planPeople(req, def, rows) {
  const plans = rows.map((row) => ({ row, action: 'create' }));
  const tenantCol = def.side === 'company' ? 'company_id' : 'school_id';

  plans.forEach((p) => {
    const long = tooLong(p.row);
    if (long) return err(p, `${long} is too long`);
    if (!p.row.email) return; // decided below, once we know whether it's an update
    try { assertValidEmail(p.row.email); } catch { err(p, `"${p.row.email}" is not a valid email address`); }
  });
  flagDuplicates(plans, (p) => (p.action === 'error' && !/Duplicate/.test(p.reason ?? '') ? null : lc(p.row.email)), 'email');

  const emails = [...new Set(plans.filter((p) => p.action !== 'error' && p.row.email).map((p) => lc(p.row.email)))];
  const existing = new Map();
  if (emails.length) {
    const { rows: found } = await pool.query(
      'SELECT id, email, role, company_id, school_id, is_active, created_by_user_id FROM users WHERE lower(email) = ANY($1::text[])',
      [emails]
    );
    for (const u of found) existing.set(lc(u.email), u);
  }

  for (const p of plans) {
    if (p.action === 'error') continue;
    const { row } = p;
    if (!row.email) { err(p, 'Email is required. Everyone signs in with their email.'); continue; }
    const user = existing.get(lc(row.email));
    if (!user) {
      const missing = missingRequired(def, row);
      if (missing.length) err(p, `Missing: ${missing.join(', ')}`);
      continue;
    }
    if (user[tenantCol] !== req.auth.tenantId) { err(p, 'This email is already registered to another account.'); continue; }
    if (user.role !== def.role) { err(p, `This email already belongs to a ${user.role.replace('_', ' ')} account.`); continue; }
    if (!user.is_active) { err(p, 'This account is deactivated. Reactivate it before importing changes.'); continue; }
    if (user.created_by_user_id && user.created_by_user_id !== req.auth.userId) { err(p, 'This account was created by another admin, so only that admin can change it.'); continue; }
    p.action = 'update';
    p.existingId = user.id;
  }
  return plans;
}

// A new account: generated temporary password (returned once), must change it at first login.
async function insertUser(client, req, def, row) {
  const temporaryPassword = generateTempPassword();
  const password_hash = await hashPassword(temporaryPassword, TEMP_HASH_ROUNDS);
  const tenantCol = def.side === 'company' ? 'company_id' : 'school_id';
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, full_name, role, ${tenantCol}, phone, address, license_number,
                        email_verified_at, created_by_user_id, must_change_password, temp_password_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9, true, now() + interval '${TEMP_PASSWORD_DAYS} days') RETURNING id`,
    [row.email, password_hash, row.full_name, def.role, req.auth.tenantId, row.phone || null, row.address || null, row.license_number || null, req.auth.userId]
  );
  return { id: rows[0].id, temporaryPassword };
}

// Writes only the keys that carry a value. '' (a blank cell) means "leave this value alone", and so
// does undefined (a field this import type doesn't have): node-postgres would write undefined as
// NULL. Callers build `patch` from the import type's own fields; skipping undefined here as well
// means a slip there can't blank a column again.
const writtenKeys = (patch) => Object.keys(patch).filter((k) => patch[k] !== '' && patch[k] !== undefined);

async function updateFields(client, table, id, tenantCol, tenantId, patch) {
  const keys = writtenKeys(patch);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `"${k}" = $${i + 3}`);
  await client.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1 AND ${tenantCol} = $2`, [id, tenantId, ...keys.map((k) => patch[k])]);
}

// What an update of an existing person sends to updateFields: only this type's own fields (each
// field key is the users column of the same name), minus the email it was matched on. A field the
// type doesn't list is never written, so importing staff (no address field) can't touch their
// address, and adding a field to a type later needs no change here.
function personUpdatePatch(def, plan) {
  return Object.fromEntries(def.fields.filter((fd) => fd.key !== def.key).map((fd) => [fd.key, plan.row[fd.key]]));
}

async function execPerson(req, def, plan, credentials) {
  const { row } = plan;
  const tenantCol = def.side === 'company' ? 'company_id' : 'school_id';
  if (plan.action === 'update') {
    await withTx((c) => updateFields(c, 'users', plan.existingId, tenantCol, req.auth.tenantId, personUpdatePatch(def, plan)));
    return;
  }
  const made = await withTx((c) => insertUser(c, req, def, row));
  credentials.push({ full_name: row.full_name, email: row.email, role: def.role, temporary_password: made.temporaryPassword });
}

// ---- vans ---------------------------------------------------------------------------------------

async function planVans(req, def, rows) {
  const plans = rows.map((row) => ({ row, action: 'create' }));
  plans.forEach((p) => {
    const long = tooLong(p.row);
    if (long) return err(p, `${long} is too long`);
    if (!p.row.license_plate) return err(p, 'License plate is required. It identifies the van.');
    if (p.row.year && !(/^\d{4}$/.test(p.row.year) && +p.row.year >= 1900 && +p.row.year <= 2100)) err(p, 'Year must be a 4-digit year, like 2022');
    else if (p.row.number && p.row.number.length > 10) err(p, 'Van number must be 10 characters or fewer');
  });
  flagDuplicates(plans, (p) => (p.action === 'error' && !/Duplicate/.test(p.reason ?? '') ? null : lc(p.row.license_plate)), 'license plate');
  flagDuplicates(plans, (p) => (p.action === 'error' && !/Duplicate/.test(p.reason ?? '') ? null : (p.row.number ? lc(p.row.number) : null)), 'van number');

  const { rows: vans } = await pool.query('SELECT id, license_plate, number FROM vans WHERE company_id = $1', [req.auth.tenantId]);
  const byPlate = new Map(vans.map((v) => [lc(v.license_plate.trim()), v]));
  const byNumber = new Map(vans.filter((v) => v.number).map((v) => [lc(v.number), v]));
  for (const p of plans) {
    if (p.action === 'error') continue;
    const van = byPlate.get(lc(p.row.license_plate));
    if (p.row.number) {
      const holder = byNumber.get(lc(p.row.number));
      if (holder && (!van || holder.id !== van.id)) { err(p, `Another van already has number ${p.row.number}.`); continue; }
    }
    if (van) { p.action = 'update'; p.existingId = van.id; continue; }
    const missing = missingRequired(def, p.row);
    if (missing.length) err(p, `Missing: ${missing.join(', ')}`);
  }
  return plans;
}

// What an update of an existing van sends to updateFields.
function vanUpdatePatch(plan) {
  const { row } = plan;
  return { license_plate: row.license_plate, brand: row.brand, model: row.model, color: row.color, number: row.number, year: row.year ? Number(row.year) : '' };
}

async function execVan(req, plan) {
  const { row } = plan;
  if (plan.action === 'update') {
    await withTx((c) => updateFields(c, 'vans', plan.existingId, 'company_id', req.auth.tenantId, vanUpdatePatch(plan)));
    return;
  }
  const { rows: [van] } = await pool.query(
    'INSERT INTO vans (company_id, license_plate, brand, model, year, color, number) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [req.auth.tenantId, row.license_plate, row.brand, row.model, Number(row.year), row.color, row.number || null]
  );
  // Same as POST /vans: every van starts with the built-in maintenance items.
  await createBuiltins(pool, req.auth.tenantId, van.id);
}

// ---- schools ------------------------------------------------------------------------------------
//
// A school is a separate tenant: the company creates it as an unclaimed placeholder (same as
// POST /placeholders/school) and may change it only while it is still unclaimed and was added by
// one of this company's users. Once the school has its own SafeTurns account, its details are theirs.

const OWN_ACCOUNT = (name) => `${name} has its own SafeTurns account, so only they can change its details.`;

async function planSchools(req, def, rows) {
  const plans = rows.map((row) => ({ row, action: 'create' }));
  plans.forEach((p) => {
    const r = p.row;
    const long = tooLong(r);
    if (long) return err(p, `${long} is too long`);
    const missing = missingRequired(def, r);
    if (missing.length) return err(p, `Missing: ${missing.join(', ')}`);
    if (r.state) {
      try { r.state = assertValidState(r.state); } catch { return err(p, 'State must be a 2-letter US state code, like IL'); }
    }
    if (r.zip_code) {
      try { assertValidZip(r.zip_code); } catch { return err(p, 'Zip code must be a valid US zip, like 60601'); }
    }
  });
  flagDuplicates(plans, (p) => (p.action === 'error' && !/Duplicate/.test(p.reason ?? '') ? null : (p.row.name ? lc(p.row.name) : null)), 'school name');

  const schoolsByName = new Map();
  for (const s of await listCompanySchools(req.auth.tenantId)) {
    const k = lc(s.name.trim());
    schoolsByName.set(k, [...(schoolsByName.get(k) ?? []), s]);
  }
  for (const p of plans) {
    if (p.action === 'error') continue;
    const matches = schoolsByName.get(lc(p.row.name));
    if (!matches) continue; // create
    if (matches.length > 1) { err(p, `More than one school is named "${p.row.name}".`); continue; }
    const s = matches[0];
    if (s.claim_status !== 'unclaimed') { err(p, OWN_ACCOUNT(s.name)); continue; }
    if (!s.added_by_company) { err(p, `${s.name} was added by another company, so only they can change its details.`); continue; }
    p.action = 'update';
    p.existingId = s.id;
  }
  return plans;
}

function schoolUpdatePatch(plan) {
  const { row } = plan;
  return { name: row.name, address: row.address, state: row.state, zip_code: row.zip_code, phone: row.phone, hours: row.hours, website: row.website };
}

// Raw pool, not req.db: schools has no company tenant column, so the scoped accessor has no entry
// for it (same as services/placeholders.js). A deliberate cross-tenant write, so the guard is in
// the SQL itself. An update re-checks it in the WHERE clause rather than trusting the plan: the
// school can be claimed between preview and commit.
async function execSchool(req, plan) {
  const { row } = plan;
  if (plan.action === 'update') {
    const patch = schoolUpdatePatch(plan);
    const keys = writtenKeys(patch);
    const sets = keys.map((k, i) => `"${k}" = $${i + 3}`);
    const { rowCount } = await pool.query(
      `UPDATE schools SET ${sets.join(', ')} WHERE id = $1
          AND claim_status = 'unclaimed'
          AND created_by_user_id IN (SELECT id FROM users WHERE company_id = $2)`,
      [plan.existingId, req.auth.tenantId, ...keys.map((k) => patch[k])]
    );
    return rowCount === 1 ? null : OWN_ACCOUNT(row.name);
  }
  await pool.query(
    `INSERT INTO schools (name, address, state, zip_code, phone, hours, website, claim_status, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'unclaimed',$8)`,
    [row.name, row.address, row.state || null, row.zip_code || null, row.phone || null, row.hours || null, row.website || null, req.auth.userId]
  );
  return null;
}

// ---- assignments --------------------------------------------------------------------------------
//
// No natural key on an assignment, so a row is matched to what the student has today: their
// current (not ended) assignment for an overlapping shift. None -> create. Same driver and van ->
// update its times, days, shift and end date. A different driver or van -> a reassignment: the
// current one ends the day before the new start date and the new one is created, in one
// transaction, and the preview shows it as an overwrite (driver: old -> new).
// The field rules (shift, times, days, active driver, conflicts) are services/assignmentRules.js,
// the same ones POST/PATCH /assignments use.

// 'YYYY-MM-DD' or US 'M/D/YYYY' -> 'YYYY-MM-DD', or null when it isn't a real calendar date.
function parseDate(text) {
  let y, m, d;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (hit) [, y, m, d] = hit.map(Number);
  else if ((hit = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text))) [, m, d, y] = hit.map(Number);
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
// A bare number is what Excel writes for a date cell it wasn't told to format: say so.
const dateError = (label, text) => (/^\d+(\.\d+)?$/.test(text)
  ? `${label} "${text}" looks like a spreadsheet date number. Format the column as a date, like 2026-09-01, and export again.`
  : `${label} "${text}" must be a real date, like 2026-09-01 or 9/1/2026`);

// '7:30', '07:30', '07:30:00', '7:30 AM', '3:05 pm' -> 'HH:MM' (24-hour), or null.
function parseTime(text) {
  const hit = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?m\.?$|^(\d{1,2}):(\d{2})(?::(\d{2}))?$/i.exec(text);
  if (!hit) return null;
  const ampm = hit[4]?.toLowerCase();
  let h = Number(hit[1] ?? hit[5]);
  const min = Number(hit[2] ?? hit[6]);
  const sec = hit[3] ?? hit[7];
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === 'p' ? 12 : 0);
  }
  if (h > 23 || min > 59 || (sec && Number(sec) > 59)) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
const timeError = (label, text) => (/^\d*\.\d+$/.test(text)
  ? `${label} "${text}" looks like a spreadsheet time number. Format the column as a time, like 07:30, and export again.`
  : `${label} "${text}" must be a time, like 07:30, 15:05 or 3:05 PM`);

const DAY_NAMES = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};
// 'Mon,Wed,Fri', 'monday; friday', '1,3,5' -> [1,3,5] (ISO weekdays, what normalizeWeekdays takes).
function parseDays(text) {
  return text.split(/[\s,;/]+/).filter(Boolean).map((part) => {
    const k = part.toLowerCase().replace(/\.$/, '');
    if (/^[1-7]$/.test(k)) return Number(k);
    if (DAY_NAMES[k]) return DAY_NAMES[k];
    throw new Error(`Days: "${part}" is not a weekday. Use names like Mon,Wed,Fri or numbers 1 (Monday) to 7 (Sunday).`);
  });
}

// Stored values as text, for comparing with the file and showing in the preview.
const dayText = (v) => (v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  : v == null ? null : String(v).slice(0, 10));
const timeText = (v) => (v == null ? null : String(v).slice(0, 5));
const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const daysText = (v) => (v == null ? null : v.map((d) => DAY_SHORT[d]).join(','));
const dayBefore = (ymd) => new Date(Date.parse(`${ymd}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

const SCHEDULE_KEYS = ['shift_period', 'pickup_time', 'dropoff_time', 'days_of_week'];
const givenSchedule = (v) => Object.fromEntries(SCHEDULE_KEYS.filter((k) => v[k] !== '').map((k) => [k, v[k]]));

// The row's values, validated. Blank optional cells stay '' (an update leaves those alone); the
// defaults for a new assignment are added by newAssignment, through the shared normalizeSchedule.
function parseAssignmentRow(r) {
  const v = { start_date: parseDate(r.start_date), end_date: '', pickup_time: '', dropoff_time: '' };
  if (!v.start_date) throw new Error(dateError('Start date', r.start_date));
  if (r.end_date) {
    v.end_date = parseDate(r.end_date);
    if (!v.end_date) throw new Error(dateError('End date', r.end_date));
    if (v.end_date < v.start_date) throw new Error('End date is before the start date');
  }
  for (const [k, label] of [['pickup_time', 'Pickup time'], ['dropoff_time', 'Dropoff time']]) {
    if (!r[k]) continue;
    v[k] = parseTime(r[k]);
    if (!v[k]) throw new Error(timeError(label, r[k]));
  }
  v.shift_period = r.shift_period ? r.shift_period.toLowerCase() : '';
  v.days_of_week = r.days_of_week ? parseDays(r.days_of_week) : '';
  // The same rules as POST/PATCH /assignments, on what the row gives.
  try {
    Object.assign(v, normalizeSchedule(givenSchedule(v), { partial: true }));
  } catch (e) {
    if (/shift_period/.test(e.message)) throw new Error(`Shift "${r.shift_period}" must be morning, afternoon or both`);
    if (/days_of_week/.test(e.message)) throw new Error(`Days "${r.days_of_week}" must name at least one weekday`);
    throw new Error(e.message);
  }
  return v;
}

// The assignment a row would create: blank cells get the new-assignment defaults (both shifts,
// Monday to Friday), from the shared rules.
function newAssignment(p) {
  const v = p.values;
  return {
    student_id: p.studentId, driver_user_id: p.driver.id, van_id: p.van.id,
    start_date: v.start_date, end_date: v.end_date || null, ...normalizeSchedule(givenSchedule(v)),
  };
}

// What an update of the student's current assignment (same driver and van) writes. Blank cells
// are skipped by updateFields, so they leave the stored value alone.
function assignmentUpdatePatch(plan) {
  const v = plan.values;
  return { end_date: v.end_date, pickup_time: v.pickup_time, dropoff_time: v.dropoff_time, shift_period: v.shift_period, days_of_week: v.days_of_week };
}

async function planAssignments(req, def, rows) {
  const tenantId = req.auth.tenantId;
  const plans = rows.map((row) => ({ row, action: 'create' }));

  const schoolsByName = new Map();
  for (const s of await listCompanySchools(tenantId)) {
    const k = lc(s.name.trim());
    schoolsByName.set(k, [...(schoolsByName.get(k) ?? []), s]);
  }
  const emails = [...new Set(rows.map((r) => lc(r.driver_email)).filter(Boolean))];
  const [{ rows: students }, { rows: drivers }, { rows: vans }, { rows: current }] = await Promise.all([
    pool.query('SELECT id, school_id, full_name, student_id FROM students WHERE company_id = $1', [tenantId]),
    // Only this company's users: an email from another company is "not found", never theirs.
    pool.query('SELECT id, email, full_name, role, is_active FROM users WHERE company_id = $1 AND lower(email) = ANY($2::text[])', [tenantId, emails]),
    pool.query('SELECT id, license_plate FROM vans WHERE company_id = $1', [tenantId]),
    pool.query('SELECT * FROM assignments WHERE company_id = $1', [tenantId]),
  ]);
  const driversByEmail = new Map(drivers.map((u) => [lc(u.email), u]));
  const vansByPlate = new Map(vans.map((v) => [lc(v.license_plate.trim()), v]));
  const vansById = new Map(vans.map((v) => [v.id, v]));

  plans.forEach((p) => {
    const r = p.row;
    const long = tooLong(r);
    if (long) return err(p, `${long} is too long`);
    const missing = missingRequired(def, r);
    if (missing.length) return err(p, `Missing: ${missing.join(', ')}`);
    try { p.values = parseAssignmentRow(r); } catch (e) { return err(p, e.message); }

    const schools = schoolsByName.get(lc(r.school));
    if (!schools) return err(p, `School "${r.school}" was not found. Import your schools first (Import, then Schools).`);
    if (schools.length > 1) return err(p, `More than one school is named "${r.school}".`);
    const school = schools[0];
    const here = students.filter((s) => s.school_id === school.id);
    const sameName = here.filter((s) => lc(s.full_name.trim()) === lc(r.student_name));
    // A Student ID is the better key (two children can share a name). A student imported before
    // they had an ID is still found by name, when exactly one at the school has that name and no ID.
    let student = r.student_id ? here.find((s) => s.student_id && lc(s.student_id) === lc(r.student_id)) : null;
    if (!student && r.student_id) {
      const noId = sameName.filter((s) => !s.student_id);
      if (noId.length !== 1) return err(p, `No student with Student ID ${r.student_id} at ${school.name}. Import the students first.`);
      student = noId[0];
    }
    if (!student) {
      if (sameName.length > 1) return err(p, `More than one student named "${r.student_name}" at ${school.name}. Add a Student ID column to tell them apart.`);
      if (!sameName.length) return err(p, `No student named "${r.student_name}" at ${school.name}. Import the students first.`);
      student = sameName[0];
    }
    p.studentId = student.id;

    const driver = driversByEmail.get(lc(r.driver_email));
    if (!driver) return err(p, `No driver in your company has the email ${r.driver_email}.`);
    try { assertActiveDriver(driver); } catch (e) { return err(p, e.message); }
    p.driver = driver;
    const van = vansByPlate.get(lc(r.van_plate));
    if (!van) return err(p, `No van in your company has the license plate ${r.van_plate}.`);
    p.van = van;
  });

  // Two rows for one student whose dates, days and shifts overlap: both are errors.
  const open = plans.filter((p) => p.action !== 'error');
  for (const a of open) {
    const ca = newAssignment(a);
    const clash = open.some((b) => {
      if (b === a || b.studentId !== a.studentId) return false;
      const cb = newAssignment(b);
      return rangesOverlap(ca.start_date, ca.end_date, cb.start_date, cb.end_date)
        && daysOverlap(ca.days_of_week, cb.days_of_week) && shiftsOverlap(ca.shift_period, cb.shift_period);
    });
    if (clash) err(a, 'Duplicate student: another row in this file assigns this student for overlapping dates. Each student needs one row per shift.');
  }

  // Match each row to the student's current assignment, then check the result for conflicts
  // against everything the company has plus the rows above it in the file, as they would be saved.
  const today = await businessDateFor(tenantId);
  const running = current.filter((a) => a.end_date == null || dayText(a.end_date) >= today);
  let planned = current.map((a) => ({ ...a }));
  const nameOf = async (userId) => (await pool.query('SELECT full_name FROM users WHERE id = $1 AND company_id = $2', [userId, tenantId])).rows[0]?.full_name ?? 'another driver';
  for (const [i, p] of plans.entries()) {
    if (p.action === 'error') continue;
    const fresh = newAssignment(p);
    const mine = running.filter((a) => a.student_id === p.studentId && shiftsOverlap(a.shift_period, fresh.shift_period)
      && rangesOverlap(a.start_date, a.end_date, fresh.start_date, fresh.end_date));
    if (mine.length > 1) { err(p, 'This student has more than one current assignment for this shift. Change it on the Assignments page.'); continue; }
    const cur = mine[0];
    let candidate;
    let others;
    if (!cur) {
      candidate = fresh;
      others = planned;
    } else if (cur.driver_user_id === p.driver.id && cur.van_id === p.van.id) {
      p.existingId = cur.id;
      const patch = assignmentUpdatePatch(p);
      candidate = { ...cur, ...Object.fromEntries(writtenKeys(patch).map((k) => [k, patch[k]])) };
      others = planned.filter((a) => a.id !== cur.id);
      p.changes = [
        ['end_date', 'End date', dayText(cur.end_date), patch.end_date],
        ['pickup_time', 'Pickup time', timeText(cur.pickup_time), patch.pickup_time],
        ['dropoff_time', 'Dropoff time', timeText(cur.dropoff_time), patch.dropoff_time],
        ['shift_period', 'Shift', cur.shift_period, patch.shift_period],
        ['days_of_week', 'Days', daysText(cur.days_of_week), patch.days_of_week === '' ? '' : daysText(patch.days_of_week)],
      ].filter(([, , old, nw]) => nw !== '' && old !== nw).map(([field, label, old, nw]) => ({ field, label, old, new: nw }));
    } else {
      // Reassignment: the current one ends the day before the new one starts.
      if (fresh.start_date <= dayText(cur.start_date)) {
        err(p, `This student's current assignment started ${dayText(cur.start_date)}. A new driver or van has to start after that. To replace it from its first day, change it on the Assignments page.`);
        continue;
      }
      p.reassign = { id: cur.id, endDate: dayBefore(fresh.start_date) };
      candidate = fresh;
      others = planned.map((a) => (a.id === cur.id ? { ...a, end_date: p.reassign.endDate } : a));
      p.changes = [
        { field: 'driver', label: 'Driver', old: cur.driver_user_id === p.driver.id ? p.driver.full_name : await nameOf(cur.driver_user_id), new: p.driver.full_name },
        { field: 'van', label: 'Van', old: vansById.get(cur.van_id)?.license_plate ?? 'another van', new: p.van.license_plate },
      ].filter((c) => c.old !== c.new);
      p.note = `Ends the current assignment on ${p.reassign.endDate} and starts the new one on ${fresh.start_date}`;
    }
    try { assertNoConflicts(others, candidate); } catch (e) { err(p, e.message); delete p.changes; delete p.reassign; delete p.existingId; delete p.note; continue; }
    p.action = cur ? 'update' : 'create';
    p.candidate = candidate;
    // Later rows are checked against this one as it will be saved.
    planned = p.existingId ? [...others, candidate] : [...others, { ...candidate, id: `row-${i}` }];
  }
  return plans;
}

// One transaction, with a scoped accessor over that transaction's client, so the shared check
// (assertAssignable) runs again at write time and sees a reassignment's ended row before the new
// one goes in. Anything it refuses rolls the whole row back.
async function execAssignment(req, plan) {
  const tenantId = req.auth.tenantId;
  await withTx(async (c) => {
    const db = createScopedDb(c, { type: 'company', id: tenantId }, { userId: req.auth.userId, role: req.auth.role });
    if (plan.existingId) {
      await assertAssignable(db, plan.candidate, { excludeId: plan.existingId });
      await updateFields(c, 'assignments', plan.existingId, 'company_id', tenantId, assignmentUpdatePatch(plan));
      return;
    }
    if (plan.reassign) {
      const { rowCount } = await c.query(
        'UPDATE assignments SET end_date = $3 WHERE id = $1 AND company_id = $2 AND (end_date IS NULL OR end_date > $3)',
        [plan.reassign.id, tenantId, plan.reassign.endDate]
      );
      if (rowCount !== 1) throw new HttpError(409, "The student's current assignment changed after the preview. Preview the file again.");
    }
    await assertAssignable(db, plan.candidate);
    await db.insert('assignments', plan.candidate);
  });
}

// ---- students -----------------------------------------------------------------------------------

async function planStudents(req, def, rows) {
  const plans = rows.map((row) => ({ row, action: 'create' }));
  const schools = await listCompanySchools(req.auth.tenantId);
  const schoolsByName = new Map();
  for (const s of schools) {
    const k = lc(s.name.trim());
    schoolsByName.set(k, [...(schoolsByName.get(k) ?? []), s]);
  }

  plans.forEach((p) => {
    const r = p.row;
    const long = tooLong(r);
    if (long) return err(p, `${long} is too long`);
    // `required` is what a NEW student needs (checked below, once the row is known to be a
    // create). An update only needs what identifies the student, and checks only the values the
    // file gives: a blank cell leaves the stored value alone (studentUpdatePatch).
    p.missing = missingRequired(def, r);
    if (!r.full_name || !r.school) return err(p, `Missing: ${p.missing.join(', ')}`);
    if (r.age && (!/^\d{1,2}$/.test(r.age) || +r.age > 25)) return err(p, 'Age must be a whole number from 0 to 25');
    if (r.zip_code) {
      try { assertValidZip(r.zip_code); } catch { return err(p, 'Zip code must be a valid US zip, like 60601'); }
    }
    if (r.state) {
      try { r.state = assertValidState(r.state); } catch { return err(p, 'State must be a 2-letter US state code, like IL'); }
    }
    if (r.parent_email) {
      try { assertValidEmail(r.parent_email); } catch { return err(p, `"${r.parent_email}" is not a valid parent email address`); }
    }
    if (r.student_id.length > 50) return err(p, 'Student ID must be 50 characters or fewer');
    const matches = schoolsByName.get(lc(r.school));
    // No such school means no existing student there either: it can only be a new one.
    if (!matches && p.missing.length) return err(p, `Missing: ${p.missing.join(', ')}`);
    if (!matches) return err(p, `School "${r.school}" was not found. Import your schools first (Import, then Schools), then import the students.`);
    if (matches.length > 1) return err(p, `More than one school is named "${r.school}".`);
    p.schoolId = matches[0].id;
  });
  // With a Student ID, the ID is the key (two children may share a name); without one, the name is.
  const stillOpen = (p) => !(p.action === 'error' && !/Duplicate/.test(p.reason ?? ''));
  flagDuplicates(plans, (p) => (stillOpen(p) && p.schoolId && p.row.student_id ? `${p.schoolId}|${lc(p.row.student_id)}` : null), 'Student ID at this school');
  flagDuplicates(plans, (p) => (stillOpen(p) && p.schoolId && !p.row.student_id ? `${p.schoolId}|${lc(p.row.full_name)}` : null), 'student');

  const { rows: existing } = await pool.query('SELECT id, school_id, full_name, student_id FROM students WHERE company_id = $1', [req.auth.tenantId]);
  const byKey = new Map();
  const byStudentId = new Map();
  for (const s of existing) {
    const k = `${s.school_id}|${lc(s.full_name.trim())}`;
    byKey.set(k, [...(byKey.get(k) ?? []), s]);
    if (s.student_id) byStudentId.set(`${s.school_id}|${lc(s.student_id)}`, s);
  }

  // Parents: one lookup for every parent_email in the file.
  const parentEmails = [...new Set(plans.filter((p) => p.action !== 'error' && p.row.parent_email).map((p) => lc(p.row.parent_email)))];
  const parents = new Map();
  if (parentEmails.length) {
    const { rows: found } = await pool.query('SELECT id, email, role, company_id, is_active FROM users WHERE lower(email) = ANY($1::text[])', [parentEmails]);
    for (const u of found) parents.set(lc(u.email), u);
  }
  const willCreate = new Set();
  for (const p of plans) {
    if (p.action === 'error') continue;
    const sameName = byKey.get(`${p.schoolId}|${lc(p.row.full_name)}`) ?? [];
    if (p.row.student_id) {
      const idKey = `${p.schoolId}|${lc(p.row.student_id)}`;
      const byId = byStudentId.get(idKey);
      if (byId) { p.action = 'update'; p.existingId = byId.id; }
      else {
        // First import with IDs over an existing roster: exactly one same-name student at this
        // school without an ID is that child, so the row updates them and adds the ID (shown in
        // the preview). Two or more is ambiguous: a row error, never a guess or a duplicate.
        const noId = sameName.filter((s) => !s.student_id);
        if (noId.length > 1) {
          err(p, 'More than one student with this name at this school has no Student ID yet, so it is not clear which one this is. Add the ID on the right record first.');
          continue;
        }
        if (noId.length === 1) {
          p.action = 'update';
          p.existingId = noId[0].id;
          p.attachStudentId = true;
          p.note = `Adds Student ID ${p.row.student_id} to the existing student`;
        }
      }
    } else {
      if (sameName.length > 1) { err(p, 'More than one existing student has this name at this school, so it is not clear which to update.'); continue; }
      if (sameName.length === 1) { p.action = 'update'; p.existingId = sameName[0].id; }
    }
    if (p.action === 'create' && p.missing.length) { err(p, `Missing: ${p.missing.join(', ')}`); continue; }
    if (p.row.parent_email) {
      const k = lc(p.row.parent_email);
      const u = parents.get(k);
      if (u) {
        if (u.company_id !== req.auth.tenantId) { err(p, 'The parent email is already registered to another account.'); continue; }
        if (u.role !== 'parent') { err(p, `The parent email belongs to a ${u.role.replace('_', ' ')} account, not a parent.`); continue; }
        if (!u.is_active) { err(p, 'The parent account is deactivated.'); continue; }
      } else if (!willCreate.has(k)) {
        // An update row may leave the parent's name or phone blank; a new account needs both.
        if (!p.row.parent_name || !p.row.parent_phone) { err(p, 'Creating the parent account needs a Parent name and a Parent phone in this row.'); continue; }
        willCreate.add(k);
        p.note = 'Also creates a parent account';
      }
    }
  }
  return plans;
}

// What an update of an existing student sends to updateFields (blank cells are skipped there).
// Notes stay the raw cell: notes hold disability and safety information, and a blank cell (or no
// Notes column) must leave the stored note alone. The 'None' default is for NEW students only
// (see the insert below); it used to be applied here too and wiped every note on a re-import.
function studentUpdatePatch(plan) {
  const { row } = plan;
  return {
    // '' (a blank cell) is skipped by updateFields; Number('') would have written age 0.
    full_name: row.full_name, grade: row.grade, age: row.age === '' ? '' : Number(row.age), parent_name: row.parent_name, parent_phone: row.parent_phone,
    street_address: row.street_address, city: row.city, state: row.state, zip_code: row.zip_code, notes: row.notes,
    // Only when the preview said so (an existing student getting their first ID); an ID match
    // never rewrites the stored ID.
    ...(plan.attachStudentId ? { student_id: row.student_id } : {}),
  };
}

async function execStudent(req, def, plan, credentials) {
  const { row } = plan;
  return withTx(async (c) => {
    const tenantId = req.auth.tenantId;
    let studentId = plan.existingId;
    if (plan.action === 'update') {
      await updateFields(c, 'students', studentId, 'company_id', tenantId, studentUpdatePatch(plan));
    } else {
      const { rows } = await c.query(
        `INSERT INTO students (company_id, school_id, full_name, grade, age, parent_name, parent_phone, street_address, city, state, zip_code, notes, student_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [tenantId, plan.schoolId, row.full_name, row.grade, Number(row.age), row.parent_name, row.parent_phone, row.street_address, row.city, row.state, row.zip_code, row.notes || 'None', row.student_id || null]
      );
      studentId = rows[0].id;
    }
    if (!row.parent_email) return studentId;

    // Find the parent again now (an earlier row of this same file may have just created them).
    let parent = (await c.query('SELECT id FROM users WHERE lower(email) = lower($1) AND company_id = $2 AND role = \'parent\' AND is_active', [row.parent_email, tenantId])).rows[0];
    if (!parent) {
      const address = `${row.street_address}, ${row.city}, ${row.state} ${row.zip_code}`;
      const made = await insertUser(c, req, { side: 'company', role: 'parent' }, { email: row.parent_email, full_name: row.parent_name, phone: row.parent_phone, address });
      parent = { id: made.id };
      credentials.push({ full_name: row.parent_name, email: row.parent_email, role: 'parent', temporary_password: made.temporaryPassword });
    }
    await c.query(
      'INSERT INTO parent_students (parent_user_id, student_id, company_id, created_by_user_id) VALUES ($1,$2,$3,$4) ON CONFLICT (parent_user_id, student_id) DO NOTHING',
      [parent.id, studentId, tenantId, req.auth.userId]
    );
    return studentId;
  });
}

// ---- entry points -------------------------------------------------------------------------------

async function plan(req, type, rawRows) {
  const def = assertCanImport(req, type);
  const rows = normalizeRows(def, rawRows);
  if (type === 'vans') return { def, plans: await planVans(req, def, rows) };
  if (type === 'schools') return { def, plans: await planSchools(req, def, rows) };
  if (type === 'assignments') return { def, plans: await planAssignments(req, def, rows) };
  if (type === 'students') return { def, plans: await planStudents(req, def, rows) };
  return { def, plans: await planPeople(req, def, rows) };
}

const countOf = (plans, action) => plans.filter((p) => p.action === action).length;

// ---- preview: what each update would change ----------------------------------------------------
//
// For every row that will update an existing record, the fields whose value would actually change,
// with the stored value and the value from the file. It uses the same patch builders and the same
// writtenKeys rule as the import itself, so the preview shows exactly what commit would write.
// Display only: nothing here changes what the import does.

const UPDATE_TARGET = {
  vans: { table: 'vans', tenantCol: () => 'company_id', patch: (def, p) => vanUpdatePatch(p) },
  // No tenant column: the guard is "added by one of this company's users" (what the plan checked).
  schools: { table: 'schools', tenantClause: 'created_by_user_id IN (SELECT id FROM users WHERE company_id = $2)', patch: (def, p) => schoolUpdatePatch(p) },
  students: { table: 'students', tenantCol: () => 'company_id', patch: (def, p) => studentUpdatePatch(p) },
  // Worked out by the planner, which already has the current assignment and the driver/van names.
  assignments: { precomputed: true },
  people: { table: 'users', tenantCol: (def) => (def.side === 'company' ? 'company_id' : 'school_id'), patch: personUpdatePatch },
};

const asText = (v) => (v === null || v === undefined ? '' : String(v));

async function describeChanges(req, type, def, plans) {
  const target = UPDATE_TARGET[type] ?? UPDATE_TARGET.people;
  const updates = plans.filter((p) => p.action === 'update');
  if (!updates.length) return new Map();
  if (target.precomputed) {
    // A reassignment always overwrites (it ends the current assignment); otherwise the rule below:
    // the file replaces a value that is there today.
    return new Map(updates.map((p) => [p, { changes: p.changes ?? [], overwrite: Boolean(p.reassign) || (p.changes ?? []).some((c) => c.old !== null && c.old !== '') }]));
  }
  const { rows: current } = await pool.query(
    `SELECT * FROM ${target.table} WHERE id = ANY($1::uuid[]) AND ${target.tenantClause ?? `${target.tenantCol(def)} = $2`}`,
    [updates.map((p) => p.existingId), req.auth.tenantId]
  );
  const byId = new Map(current.map((r) => [r.id, r]));
  const labels = new Map(def.fields.map((fd) => [fd.key, fd.label]));
  const out = new Map();
  for (const p of updates) {
    const stored = byId.get(p.existingId) ?? {};
    const patch = target.patch(def, p);
    const changes = writtenKeys(patch)
      .filter((k) => asText(stored[k]) !== asText(patch[k]))
      .map((k) => ({ field: k, label: labels.get(k) ?? k, old: stored[k] === null || stored[k] === undefined ? null : asText(stored[k]), new: asText(patch[k]) }));
    // An overwrite: the file replaces a value that is there today (not just filling an empty one).
    out.set(p, { changes, overwrite: changes.some((c) => c.old !== null && c.old.trim() !== '') });
  }
  return out;
}

async function preview(req, type, rawRows) {
  const { def, plans } = await plan(req, type, rawRows);
  const diffs = await describeChanges(req, type, def, plans);
  const rows = plans.map((p, i) => {
    const d = diffs.get(p);
    return { index: i, action: p.action, reason: p.reason ?? null, note: p.note ?? null, changes: d ? d.changes : null, overwrite: d ? d.overwrite : false };
  });
  return {
    type,
    counts: { create: countOf(plans, 'create'), update: countOf(plans, 'update'), error: countOf(plans, 'error'), overwrite: rows.filter((r) => r.overwrite).length },
    rows,
  };
}

function friendlyDbError(e) {
  if (e instanceof HttpError) return e.message; // a shared rule refused it at write time (e.g. a new conflict)
  if (e.code === '23505') {
    if (String(e.constraint).includes('vans_company_number_unique')) return 'Another van already has this number.';
    if (String(e.constraint).includes('student_id_unique')) return 'Another of your students at this school already has this Student ID.';
    if (String(e.constraint).includes('email')) return 'This email is already registered to another account.';
    return 'This record already exists.';
  }
  return 'Could not save this row.';
}

async function commit(req, type, rawRows) {
  const { def, plans } = await plan(req, type, rawRows);
  const credentials = [];
  const results = [];
  const studentIds = new Map(); // row index -> student id
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i];
    if (p.action === 'error') { results.push({ index: i, status: 'error', reason: p.reason }); continue; }
    try {
      if (type === 'vans') await execVan(req, p);
      else if (type === 'assignments') await execAssignment(req, p);
      else if (type === 'schools') {
        // Schools create no accounts, so nothing goes into credentials.
        const refused = await execSchool(req, p);
        if (refused) { results.push({ index: i, status: 'error', reason: refused }); continue; }
      } else if (type === 'students') studentIds.set(i, await execStudent(req, def, p, credentials));
      else await execPerson(req, def, p, credentials);
      results.push({ index: i, status: p.action === 'create' ? 'created' : 'updated', reason: null });
    } catch (e) {
      if (!e.code && !(e instanceof HttpError)) console.error('[import] row failed', e.message);
      results.push({ index: i, status: 'error', reason: friendlyDbError(e) });
    }
  }
  // Imported students that now share a name with another of this company's students at the same
  // school (students.duplicate_name, kept by a DB trigger). They are saved; this is only a warning.
  const duplicates = [];
  if (studentIds.size) {
    const { rows: flagged } = await pool.query(
      'SELECT id FROM students WHERE id = ANY($1::uuid[]) AND company_id = $2 AND duplicate_name',
      [[...studentIds.values()], req.auth.tenantId]
    );
    const ids = new Set(flagged.map((r) => r.id));
    for (const [index, id] of studentIds) {
      if (ids.has(id)) duplicates.push({ index, full_name: plans[index].row.full_name, status: plans[index].action === 'create' ? 'created' : 'updated' });
    }
  }
  return {
    type,
    duplicates,
    counts: {
      created: results.filter((r) => r.status === 'created').length,
      updated: results.filter((r) => r.status === 'updated').length,
      error: results.filter((r) => r.status === 'error').length,
    },
    rows: results,
    // Shown once, in this response only. Nothing on the server can show them again: only hashes are stored.
    credentials,
  };
}

// ---- remembered column mapping ------------------------------------------------------------------

async function getMapping(req, type) {
  assertCanImport(req, type);
  const { rows } = await pool.query(
    'SELECT mapping FROM import_mappings WHERE tenant_type = $1 AND tenant_id = $2 AND import_type = $3',
    [req.auth.tenantType, req.auth.tenantId, type]
  );
  return { mapping: rows[0]?.mapping ?? null };
}

async function saveMapping(req, type, mapping) {
  const def = assertCanImport(req, type);
  const keys = new Set(def.fields.map((fd) => fd.key));
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new HttpError(400, 'mapping must be an object of field -> column name');
  const clean = {};
  for (const [k, v] of Object.entries(mapping)) {
    if (keys.has(k) && typeof v === 'string' && v.length <= 200) clean[k] = v;
  }
  await pool.query(
    `INSERT INTO import_mappings (tenant_type, tenant_id, import_type, mapping) VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_type, tenant_id, import_type) DO UPDATE SET mapping = EXCLUDED.mapping, updated_at = now()`,
    [req.auth.tenantType, req.auth.tenantId, type, JSON.stringify(clean)]
  );
  return { mapping: clean };
}

// execSchool is exported for the test that claims a school between plan and write (the WHERE guard).
module.exports = { MAX_ROWS, typesFor, preview, commit, getMapping, saveMapping, execSchool };
