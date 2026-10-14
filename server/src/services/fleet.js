// Van maintenance and fuel (branch van-maintenance). Migration 037.
//
// Admin (company_admin): reminder settings, maintenance items per van (built-in + custom, by date
// or by mileage), "Done" (keeps a record, starts the next cycle), fuel / odometer history and fixes.
// Driver: adds fuel entries for their own van and gets reminders. Nothing else.
//
// Reminders all go through sendPush (services/push.js), so they are stored, show in the bell and
// list, and reach phones and browsers like every other notification:
//  - maintenance: when an item comes within the reminder window ("due soon") and again when it is
//    overdue, to the company admins and the drivers on that van. Once per cycle each: the item's
//    reminded_for / overdue_reminded_for is claimed with a conditional UPDATE, so two API
//    instances (or the API and the cron script) never send twice. Mileage items are checked right
//    after every odometer entry; everything is also checked by runFleetReminders() (the sweep).
//  - odometer: every N days (fleet_settings.odometer_reminder_days, NULL = off) a driver who hasn't
//    entered miles for their van in N days gets "time to enter your miles".
// The sweep only sends between 07:00 and 20:00 in the company's own timezone.
//
// Mileage: the van's current mileage is its newest odometer entry (latest entry_date, then latest
// created). "Due in X miles" = due_miles - current mileage.
const pool = require('../db/pool');
const { withTx } = require('../db/tx');
const { HttpError } = require('../errors');
const { assignmentNotEndedSql } = require('../db/scoped');
const { nowInZone, DEFAULT_TIME_ZONE } = require('../time/businessDate');
const { sendPush } = require('./push');

const BUILTINS = [
  { key: 'fleet_inspection', name: 'Fleet inspection', type: 'date', days: 365 },
  { key: '7d_inspection', name: '7D inspection', type: 'date', days: 365 },
  { key: 'oil_change', name: 'Oil change', type: 'mileage', miles: 5000 },
  { key: 'brake_change', name: 'Brake change', type: 'mileage', miles: 30000 },
];
const DEFAULTS = { default_remind_days: 30, default_remind_miles: 500, odometer_reminder_days: null };
const QUIET = { from: 7 * 60, to: 20 * 60 }; // the sweep sends between 07:00 and 20:00 local

// ---- validation helpers ----

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function intIn(value, field, min, max, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${field} must be a whole number from ${min} to ${max}${nullable ? ' (or null)' : ''}`);
  }
  return value;
}
function dateOrNull(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new HttpError(400, `${field} must be a date (YYYY-MM-DD)`);
  }
  return value;
}
function nameOf(value) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'name is required');
  if (value.trim().length > 80) throw new HttpError(400, 'name must be 80 characters or fewer');
  return value.trim();
}

// ---- settings ----

async function readSettings(db, companyId) {
  const { rows } = await db.query('SELECT * FROM fleet_settings WHERE company_id = $1', [companyId]);
  const s = rows[0];
  return {
    default_remind_days: s?.default_remind_days ?? DEFAULTS.default_remind_days,
    default_remind_miles: s?.default_remind_miles ?? DEFAULTS.default_remind_miles,
    odometer_reminder_days: s ? s.odometer_reminder_days : DEFAULTS.odometer_reminder_days,
    configured: Boolean(s?.configured_at),
  };
}
const getSettings = (req) => readSettings(pool, req.auth.tenantId);

// PUT /fleet/settings { default_remind_days, default_remind_miles, odometer_reminder_days|null }.
// Vans with their own override keep it; the rest follow the new default.
async function putSettings(req, body = {}) {
  const cur = await getSettings(req);
  const days = body.default_remind_days === undefined ? cur.default_remind_days : intIn(body.default_remind_days, 'default_remind_days', 0, 365);
  const miles = body.default_remind_miles === undefined ? cur.default_remind_miles : intIn(body.default_remind_miles, 'default_remind_miles', 0, 100000);
  const odo = body.odometer_reminder_days === undefined ? cur.odometer_reminder_days : intIn(body.odometer_reminder_days, 'odometer_reminder_days', 1, 365, { nullable: true });
  await pool.query(
    `INSERT INTO fleet_settings (company_id, default_remind_days, default_remind_miles, odometer_reminder_days, configured_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (company_id) DO UPDATE SET default_remind_days = $2, default_remind_miles = $3,
       odometer_reminder_days = $4, configured_at = COALESCE(fleet_settings.configured_at, now()), updated_at = now()`,
    [req.auth.tenantId, days, miles, odo]
  );
  return getSettings(req);
}

// ---- vans / items ----

async function createBuiltins(db, companyId, vanId) {
  for (const b of BUILTINS) {
    await db.query(
      `INSERT INTO maintenance_items (company_id, van_id, name, builtin_key, schedule_type, interval_days, interval_miles)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [companyId, vanId, b.name, b.key, b.type, b.days ?? null, b.miles ?? null]
    );
  }
}

async function loadVan(db, companyId, vanId) {
  const { rows } = await db.query('SELECT * FROM vans WHERE id::text = $1 AND company_id = $2', [String(vanId), companyId]);
  return rows[0] ?? null;
}
async function vanOr404(req, vanId) {
  const van = await loadVan(pool, req.auth.tenantId, vanId);
  if (!van) throw new HttpError(404, 'van not found');
  return van;
}
const vanLabel = (v) => (v.number ? `Van ${v.number}` : v.license_plate);

async function currentMiles(db, vanId) {
  const { rows } = await db.query(
    'SELECT miles, entry_date FROM odometer_entries WHERE van_id = $1 ORDER BY entry_date DESC, created_at DESC LIMIT 1',
    [vanId]
  );
  return rows[0] ? { miles: rows[0].miles, date: rows[0].entry_date } : null;
}

// The state of one item: off | not_set | no_reading | ok | due_soon | overdue, with how much is
// left (days or miles). `today` is the company's business date.
function itemState(item, { today, miles, remindDays, remindMiles }) {
  if (!item.is_active) return { state: 'off' };
  if (item.schedule_type === 'date') {
    if (!item.due_date) return { state: 'not_set' };
    const daysLeft = Math.round((Date.parse(`${item.due_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    return { state: daysLeft < 0 ? 'overdue' : daysLeft <= remindDays ? 'due_soon' : 'ok', days_left: daysLeft };
  }
  if (item.due_miles === null || item.due_miles === undefined) return { state: 'not_set' };
  if (miles === null) return { state: 'no_reading' };
  const milesLeft = item.due_miles - miles;
  return { state: milesLeft < 0 ? 'overdue' : milesLeft <= remindMiles ? 'due_soon' : 'ok', miles_left: milesLeft };
}

function publicItem(item, st) {
  return {
    id: item.id,
    name: item.name,
    builtin_key: item.builtin_key,
    schedule_type: item.schedule_type,
    interval_days: item.interval_days,
    interval_miles: item.interval_miles,
    due_date: item.due_date,
    due_miles: item.due_miles,
    is_active: item.is_active,
    ...st,
  };
}

// date columns come back as 'YYYY-MM-DD' text (pg type parser below) for stable arithmetic.
const ITEM_COLS = `id, company_id, van_id, name, builtin_key, schedule_type, interval_days, interval_miles,
  due_date::text AS due_date, due_miles, is_active, reminded_for, overdue_reminded_for`;

async function vanContext(db, van, settings, today) {
  const reading = await currentMiles(db, van.id);
  return {
    today,
    miles: reading?.miles ?? null,
    reading,
    remindDays: van.remind_days_before ?? settings.default_remind_days,
    remindMiles: van.remind_miles_before ?? settings.default_remind_miles,
  };
}

// GET /fleet/vans/:vanId/maintenance
async function getVanMaintenance(req, vanId) {
  const van = await vanOr404(req, vanId);
  const settings = await getSettings(req);
  const ctx = await vanContext(pool, van, settings, req.businessDate);
  const { rows } = await pool.query(
    `SELECT ${ITEM_COLS} FROM maintenance_items WHERE van_id = $1 AND deleted_at IS NULL
      ORDER BY builtin_key IS NULL, created_at`,
    [van.id]
  );
  return {
    van: { id: van.id, label: vanLabel(van), remind_days_before: van.remind_days_before, remind_miles_before: van.remind_miles_before },
    reminders: { days_before: ctx.remindDays, miles_before: ctx.remindMiles, custom: van.remind_days_before !== null || van.remind_miles_before !== null },
    current_miles: ctx.miles,
    current_miles_date: ctx.reading ? dateText(ctx.reading.date) : null,
    items: rows.map((i) => publicItem(i, itemState(i, ctx))),
  };
}

// GET /fleet/due: every item due soon or overdue across the fleet (the admin's Vans page list).
async function listDue(req) {
  const settings = await getSettings(req);
  const { rows: vans } = await pool.query('SELECT * FROM vans WHERE company_id = $1', [req.auth.tenantId]);
  const out = [];
  for (const van of vans) {
    const ctx = await vanContext(pool, van, settings, req.businessDate);
    const { rows } = await pool.query(`SELECT ${ITEM_COLS} FROM maintenance_items WHERE van_id = $1 AND deleted_at IS NULL AND is_active`, [van.id]);
    for (const i of rows) {
      const st = itemState(i, ctx);
      if (st.state === 'due_soon' || st.state === 'overdue') out.push({ van_id: van.id, van_label: vanLabel(van), current_miles: ctx.miles, ...publicItem(i, st) });
    }
  }
  // Overdue first, then the soonest.
  const rank = (x) => (x.state === 'overdue' ? 0 : 1);
  out.sort((a, b) => rank(a) - rank(b) || (a.days_left ?? a.miles_left / 100) - (b.days_left ?? b.miles_left / 100));
  return { overdue: out.filter((x) => x.state === 'overdue'), due_soon: out.filter((x) => x.state === 'due_soon') };
}

function readSchedule(body, type, current = {}) {
  const out = {};
  if (type === 'date') {
    if (body.due_miles !== undefined || body.interval_miles !== undefined) throw new HttpError(400, 'a date item has a due_date and interval_days, not miles');
    if (body.due_date !== undefined) out.due_date = dateOrNull(body.due_date, 'due_date');
    if (body.interval_days !== undefined) out.interval_days = intIn(body.interval_days, 'interval_days', 1, 3650, { nullable: true });
  } else {
    if (body.due_date !== undefined || body.interval_days !== undefined) throw new HttpError(400, 'a mileage item has due_miles and interval_miles, not dates');
    if (body.due_miles !== undefined) out.due_miles = intIn(body.due_miles, 'due_miles', 0, 3000000, { nullable: true });
    if (body.interval_miles !== undefined) out.interval_miles = intIn(body.interval_miles, 'interval_miles', 1, 1000000, { nullable: true });
  }
  // A changed due value starts a new reminder cycle.
  if ((out.due_date !== undefined && out.due_date !== current.due_date) || (out.due_miles !== undefined && out.due_miles !== current.due_miles)) {
    out.reminded_for = null;
    out.overdue_reminded_for = null;
  }
  return out;
}

async function itemOr404(req, vanId, itemId) {
  const { rows } = await pool.query(
    `SELECT ${ITEM_COLS} FROM maintenance_items WHERE id::text = $1 AND van_id::text = $2 AND company_id = $3 AND deleted_at IS NULL`,
    [String(itemId), String(vanId), req.auth.tenantId]
  );
  if (!rows[0]) throw new HttpError(404, 'maintenance item not found');
  return rows[0];
}

async function updateItemRow(id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) throw new HttpError(400, 'nothing to update');
  const { rows } = await pool.query(
    `UPDATE maintenance_items SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING ${ITEM_COLS}`,
    [id, ...keys.map((k) => patch[k])]
  );
  return rows[0];
}

// POST /fleet/vans/:vanId/maintenance { name, schedule_type, due_date|due_miles, interval_days|interval_miles }
async function addItem(req, vanId, body = {}) {
  const van = await vanOr404(req, vanId);
  const name = nameOf(body.name);
  if (!['date', 'mileage'].includes(body.schedule_type)) throw new HttpError(400, "schedule_type must be 'date' or 'mileage'");
  const sched = readSchedule(body, body.schedule_type);
  const { rows } = await pool.query(
    `INSERT INTO maintenance_items (company_id, van_id, name, schedule_type, interval_days, interval_miles, due_date, due_miles)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [req.auth.tenantId, van.id, name, body.schedule_type, sched.interval_days ?? null, sched.interval_miles ?? null, sched.due_date ?? null, sched.due_miles ?? null]
  );
  await evaluateVan(req.auth.tenantId, van.id).catch(logSweepError);
  return (await getVanMaintenance(req, van.id)).items.find((i) => i.id === rows[0].id);
}

// PATCH /fleet/vans/:vanId/maintenance/:itemId { name?, is_active?, due_*?, interval_*? }
async function updateItem(req, vanId, itemId, body = {}) {
  const item = await itemOr404(req, vanId, itemId);
  const patch = readSchedule(body, item.schedule_type, item);
  if (body.name !== undefined) patch.name = nameOf(body.name);
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') throw new HttpError(400, 'is_active must be true or false');
    patch.is_active = body.is_active;
  }
  await updateItemRow(item.id, patch);
  await evaluateVan(req.auth.tenantId, item.van_id).catch(logSweepError);
  return (await getVanMaintenance(req, item.van_id)).items.find((i) => i.id === item.id);
}

// DELETE: the item disappears from the van but stays in the database with its history (audits).
// Built-ins can be turned off instead (they come back with each new van anyway).
async function deleteItem(req, vanId, itemId) {
  const item = await itemOr404(req, vanId, itemId);
  await pool.query('UPDATE maintenance_items SET deleted_at = now(), is_active = false WHERE id = $1', [item.id]);
}

// POST /fleet/vans/:vanId/maintenance/:itemId/done { done_date?, odometer?, next_due_date?, notes? }
// Keeps a record and starts the next cycle: date items move to done_date + interval_days (or the
// given next_due_date); mileage items to the odometer at the time (given, else the van's current
// mileage) + interval_miles. With no interval, the next due is left for the admin to set.
async function markDone(req, vanId, itemId, body = {}) {
  const item = await itemOr404(req, vanId, itemId);
  const doneDate = dateOrNull(body.done_date, 'done_date') ?? req.businessDate;
  const notes = body.notes === undefined || body.notes === null ? null : String(body.notes).slice(0, 500);
  let odometer = body.odometer === undefined || body.odometer === null ? null : intIn(body.odometer, 'odometer', 0, 3000000);
  if (odometer === null) odometer = (await currentMiles(pool, item.van_id))?.miles ?? null;

  let nextDate = null;
  let nextMiles = null;
  if (item.schedule_type === 'date') {
    nextDate = dateOrNull(body.next_due_date, 'next_due_date');
    if (!nextDate && item.interval_days) {
      const d = new Date(`${doneDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + item.interval_days);
      nextDate = d.toISOString().slice(0, 10);
    }
  } else {
    if (body.next_due_miles !== undefined && body.next_due_miles !== null) nextMiles = intIn(body.next_due_miles, 'next_due_miles', 0, 3000000);
    else if (item.interval_miles && odometer !== null) nextMiles = odometer + item.interval_miles;
    else if (item.interval_miles) throw new HttpError(400, 'odometer is required: this van has no miles reading yet');
  }

  const record = await withTx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO maintenance_records (company_id, van_id, item_id, item_name, done_date, odometer, was_due_date, was_due_miles,
                                        next_due_date, next_due_miles, notes, done_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [req.auth.tenantId, item.van_id, item.id, item.name, doneDate, odometer, item.due_date, item.due_miles, nextDate, nextMiles, notes, req.auth.userId]
    );
    await client.query(
      `UPDATE maintenance_items SET due_date = $2, due_miles = $3, reminded_for = NULL, overdue_reminded_for = NULL WHERE id = $1`,
      [item.id, item.schedule_type === 'date' ? nextDate : null, item.schedule_type === 'mileage' ? nextMiles : null]
    );
    return rows[0];
  });
  return { record: publicRecord(record), item: (await getVanMaintenance(req, item.van_id)).items.find((i) => i.id === item.id) };
}

// node-postgres turns a DATE into a Date at local midnight; read it back from the local parts so the
// day never shifts with the server's timezone.
const pad = (n) => String(n).padStart(2, '0');
function dateText(d) {
  if (d === null || d === undefined) return null;
  if (!(d instanceof Date)) return String(d);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function publicRecord(r) {
  return {
    id: r.id, item_id: r.item_id, item_name: r.item_name, done_date: dateText(r.done_date), odometer: r.odometer,
    was_due_date: dateText(r.was_due_date), was_due_miles: r.was_due_miles,
    next_due_date: dateText(r.next_due_date), next_due_miles: r.next_due_miles,
    notes: r.notes, done_by: r.done_by_name ?? null, created_at: r.created_at,
  };
}

// GET /fleet/vans/:vanId/history?item_id= : every Done, newest first (deleted items included).
async function history(req, vanId, { item_id } = {}) {
  const van = await vanOr404(req, vanId);
  const { rows } = await pool.query(
    `SELECT r.*, u.full_name AS done_by_name FROM maintenance_records r JOIN users u ON u.id = r.done_by_user_id
      WHERE r.van_id = $1 AND ($2::text IS NULL OR r.item_id::text = $2)
      ORDER BY r.done_date DESC, r.created_at DESC`,
    [van.id, item_id ? String(item_id) : null]
  );
  return rows.map(publicRecord);
}

// PATCH /fleet/vans/:vanId/reminders { remind_days_before|null, remind_miles_before|null }
// null = follow the company default again.
async function setVanReminders(req, vanId, body = {}) {
  const van = await vanOr404(req, vanId);
  const patch = {};
  if (body.remind_days_before !== undefined) patch.remind_days_before = intIn(body.remind_days_before, 'remind_days_before', 0, 365, { nullable: true });
  if (body.remind_miles_before !== undefined) patch.remind_miles_before = intIn(body.remind_miles_before, 'remind_miles_before', 0, 100000, { nullable: true });
  const keys = Object.keys(patch);
  if (!keys.length) throw new HttpError(400, 'nothing to update');
  await pool.query(`UPDATE vans SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [van.id, ...keys.map((k) => patch[k])]);
  await evaluateVan(req.auth.tenantId, van.id).catch(logSweepError);
  return (await getVanMaintenance(req, van.id)).reminders;
}

// ---- fuel / odometer ----

// The vans a driver drives: on their not-ended assignments.
async function driverVanIds(companyId, driverId, today) {
  const { rows } = await pool.query(
    `SELECT DISTINCT van_id FROM assignments a WHERE a.company_id = $1 AND a.driver_user_id = $2 AND ${assignmentNotEndedSql('a', '$3::date')}`,
    [companyId, driverId, today]
  );
  return rows.map((r) => r.van_id);
}

function readEntry(body, { requireMiles }) {
  const out = {};
  if (body.miles !== undefined || requireMiles) out.miles = intIn(body.miles, 'miles', 0, 3000000);
  if (body.gallons !== undefined) {
    if (body.gallons === null || body.gallons === '') out.gallons = null;
    else {
      const g = Number(body.gallons);
      if (!Number.isFinite(g) || g <= 0 || g > 1000) throw new HttpError(400, 'gallons must be a number above 0');
      out.gallons = Math.round(g * 100) / 100;
    }
  }
  if (body.cost !== undefined) {
    if (body.cost === null || body.cost === '') out.cost_cents = null;
    else {
      const c = Number(body.cost);
      if (!Number.isFinite(c) || c < 0 || c > 100000) throw new HttpError(400, 'cost must be an amount in dollars');
      out.cost_cents = Math.round(c * 100);
    }
  }
  if (body.entry_date !== undefined) out.entry_date = dateOrNull(body.entry_date, 'entry_date');
  return out;
}

function publicEntry(e) {
  return {
    id: e.id, van_id: e.van_id, entry_date: dateText(e.entry_date), miles: e.miles,
    gallons: e.gallons === null ? null : Number(e.gallons), cost: e.cost_cents === null ? null : e.cost_cents / 100,
    entered_by: e.entered_by_name ?? null, edited_at: e.edited_at, created_at: e.created_at,
  };
}

// POST /fleet/fuel { van_id?, miles, gallons?, cost?, entry_date? }
// Driver: their own van (van_id may be left out when they drive one), dated today, and the miles
// can't go below the van's newest reading (a typo there would wreck the mileage reminders; the
// office can fix it). Admin: any company van, any date.
async function addEntry(req, body = {}) {
  const isDriver = req.auth.role === 'driver';
  let vanId = body.van_id;
  if (isDriver) {
    const mine = await driverVanIds(req.auth.tenantId, req.auth.userId, req.businessDate);
    if (!vanId && mine.length === 1) vanId = mine[0];
    if (!vanId) throw new HttpError(400, mine.length ? 'van_id is required: you drive more than one van' : 'you have no van assigned');
    if (!mine.includes(String(vanId))) throw new HttpError(404, 'van not found');
  }
  if (!vanId) throw new HttpError(400, 'van_id is required');
  const van = await vanOr404(req, vanId);
  const e = readEntry(body, { requireMiles: true });
  if (isDriver) {
    delete e.entry_date; // a driver enters today's reading
    const last = await currentMiles(pool, van.id);
    if (last && e.miles < last.miles) {
      throw new HttpError(409, `That's less than the last reading (${last.miles.toLocaleString('en-US')} miles). Check the odometer, or ask the office to fix the last entry.`);
    }
  }
  const { rows } = await pool.query(
    `INSERT INTO odometer_entries (company_id, van_id, entry_date, miles, gallons, cost_cents, entered_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [req.auth.tenantId, van.id, e.entry_date ?? req.businessDate, e.miles, e.gallons ?? null, e.cost_cents ?? null, req.auth.userId]
  );
  // A new reading may bring a mileage item due: tell people now, not at the next sweep.
  await evaluateVan(req.auth.tenantId, van.id).catch(logSweepError);
  return publicEntry(rows[0]);
}

// PATCH /fleet/fuel/:id (admin): fix miles / gallons / cost / date. Stamped with who and when.
async function updateEntry(req, id, body = {}) {
  const e = readEntry(body, { requireMiles: false });
  if (e.entry_date === null) delete e.entry_date;
  const keys = Object.keys(e);
  if (!keys.length) throw new HttpError(400, 'nothing to update');
  const { rows } = await pool.query(
    `UPDATE odometer_entries SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, edited_by_user_id = $2, edited_at = now()
      WHERE id::text = $1 AND company_id = $${keys.length + 3} RETURNING *`,
    [String(id), req.auth.userId, ...keys.map((k) => e[k]), req.auth.tenantId]
  );
  if (!rows[0]) throw new HttpError(404, 'entry not found');
  await evaluateVan(req.auth.tenantId, rows[0].van_id).catch(logSweepError);
  return publicEntry(rows[0]);
}

async function entriesFor(vanIds, limit = 100) {
  if (!vanIds.length) return [];
  const { rows } = await pool.query(
    `SELECT e.*, u.full_name AS entered_by_name FROM odometer_entries e JOIN users u ON u.id = e.entered_by_user_id
      WHERE e.van_id = ANY($1::uuid[]) ORDER BY e.entry_date DESC, e.created_at DESC LIMIT $2`,
    [vanIds, limit]
  );
  return rows.map(publicEntry);
}

// GET /fleet/vans/:vanId/fuel (admin)
async function listEntries(req, vanId) {
  const van = await vanOr404(req, vanId);
  return entriesFor([van.id], 500);
}

// GET /fleet/fuel/mine (driver): their vans and the recent entries on them.
async function myFuel(req) {
  const ids = await driverVanIds(req.auth.tenantId, req.auth.userId, req.businessDate);
  const { rows: vans } = ids.length ? await pool.query('SELECT * FROM vans WHERE id = ANY($1::uuid[])', [ids]) : { rows: [] };
  const out = [];
  for (const v of vans) {
    const reading = await currentMiles(pool, v.id);
    out.push({ id: v.id, label: vanLabel(v), current_miles: reading?.miles ?? null });
  }
  return { vans: out, entries: await entriesFor(ids, 30) };
}

// ---- reminders ----

function logSweepError(err) {
  console.error('[fleet] reminder check failed', err?.message ?? err);
}

async function vanRecipients(companyId, vanId, today) {
  const { rows } = await pool.query(
    `SELECT id, role FROM users WHERE company_id = $1 AND is_active AND (
        role = 'company_admin'
        OR (role = 'driver' AND id IN (SELECT a.driver_user_id FROM assignments a
              WHERE a.van_id = $2 AND a.company_id = $1 AND ${assignmentNotEndedSql('a', '$3::date')})))`,
    [companyId, vanId, today]
  );
  return rows;
}

function dueText(item, st, miles) {
  if (item.schedule_type === 'date') {
    const on = new Date(`${item.due_date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    if (st.state === 'overdue') return `was due ${on} (${-st.days_left} day${st.days_left === -1 ? '' : 's'} ago)`;
    return st.days_left === 0 ? `is due today (${on})` : `is due in ${st.days_left} day${st.days_left === 1 ? '' : 's'} (${on})`;
  }
  const fmt = (n) => n.toLocaleString('en-US');
  if (st.state === 'overdue') return `was due at ${fmt(item.due_miles)} miles (now ${fmt(miles)}, ${fmt(-st.miles_left)} over)`;
  return `is due in ${fmt(st.miles_left)} miles (at ${fmt(item.due_miles)}; now ${fmt(miles)})`;
}

// Check one van's items and send what's newly due soon / overdue. Returns pushes sent.
async function evaluateVan(companyId, vanId, { today } = {}) {
  const van = await loadVan(pool, companyId, vanId);
  if (!van) return 0;
  const tz = (await pool.query('SELECT timezone FROM companies WHERE id = $1', [companyId])).rows[0]?.timezone ?? DEFAULT_TIME_ZONE;
  const day = today ?? nowInZone(tz, new Date()).date;
  const ctx = await vanContext(pool, van, await readSettings(pool, companyId), day);
  const { rows: items } = await pool.query(`SELECT ${ITEM_COLS} FROM maintenance_items WHERE van_id = $1 AND deleted_at IS NULL AND is_active`, [van.id]);
  let sent = 0;
  for (const item of items) {
    const st = itemState(item, ctx);
    if (st.state !== 'due_soon' && st.state !== 'overdue') continue;
    const key = item.schedule_type === 'date' ? `date:${item.due_date}` : `miles:${item.due_miles}`;
    const column = st.state === 'overdue' ? 'overdue_reminded_for' : 'reminded_for';
    // Claim it: only the caller that flips the column sends. Overdue also marks "due soon" done.
    const { rowCount } = await pool.query(
      `UPDATE maintenance_items SET ${column} = $2${column === 'overdue_reminded_for' ? ', reminded_for = $2' : ''}
        WHERE id = $1 AND ${column} IS DISTINCT FROM $2`,
      [item.id, key]
    );
    if (!rowCount) continue;
    const title = `${item.name} ${st.state === 'overdue' ? 'overdue' : 'due soon'}: ${vanLabel(van)}`;
    const body = `${item.name} for ${vanLabel(van)} ${dueText(item, st, ctx.miles)}.`;
    for (const r of await vanRecipients(companyId, van.id, day)) {
      const admin = r.role === 'company_admin';
      try {
        await sendPush(r.id, title, body, {
          kind: 'maintenance', state: st.state, van_id: van.id, item_id: item.id,
          route: admin ? '/(company)/fleet' : '/(driver)/fuel',
          web_route: admin ? '/company/vans' : '/driver/fuel',
        }, { category: 'maintenance' });
        sent += 1;
      } catch (err) {
        logSweepError(err);
      }
    }
  }
  return sent;
}

// Odometer reminders for one company: drivers whose vans have no entry in N days, at most once
// every N days per driver (odometer_reminder_state, claimed with a conditional upsert).
async function remindOdometer(companyId, days, today) {
  const { rows: drivers } = await pool.query(
    `SELECT DISTINCT u.id FROM users u JOIN assignments a ON a.driver_user_id = u.id AND a.company_id = u.company_id
      WHERE u.company_id = $1 AND u.role = 'driver' AND u.is_active AND a.start_date <= $2::date
        AND ${assignmentNotEndedSql('a', '$2::date')}`,
    [companyId, today]
  );
  let sent = 0;
  for (const d of drivers) {
    const vanIds = await driverVanIds(companyId, d.id, today);
    if (!vanIds.length) continue;
    const { rows: [recent] } = await pool.query(
      `SELECT 1 AS yes FROM odometer_entries WHERE van_id = ANY($1::uuid[]) AND created_at > now() - make_interval(days => $2) LIMIT 1`,
      [vanIds, days]
    );
    if (recent) continue;
    const { rowCount } = await pool.query(
      `INSERT INTO odometer_reminder_state (driver_user_id, last_sent_at) VALUES ($1, now())
       ON CONFLICT (driver_user_id) DO UPDATE SET last_sent_at = now()
        WHERE odometer_reminder_state.last_sent_at < now() - make_interval(days => $2)`,
      [d.id, days]
    );
    if (!rowCount) continue;
    try {
      await sendPush(d.id, "Time to enter your van's miles", 'Add the odometer reading (and fuel, if you filled up). It keeps the van\'s maintenance on time.',
        { kind: 'odometer_reminder', route: '/(driver)/fuel', web_route: '/driver/fuel' }, { category: 'odometer_reminder' });
      sent += 1;
    } catch (err) {
      logSweepError(err);
    }
  }
  return sent;
}

// The sweep (src/index.js every FLEET_SWEEP_MS; scripts/send-due-notifications.js too). Only
// between 07:00 and 20:00 in each company's own timezone, so nobody is woken up by a reminder.
async function runFleetReminders({ now = new Date() } = {}) {
  const { rows: companies } = await pool.query(
    `SELECT c.id, c.timezone, fs.odometer_reminder_days FROM companies c LEFT JOIN fleet_settings fs ON fs.company_id = c.id
      WHERE c.claim_status = 'claimed' AND EXISTS (SELECT 1 FROM vans v WHERE v.company_id = c.id)`
  );
  let sent = 0;
  for (const c of companies) {
    const local = nowInZone(c.timezone ?? DEFAULT_TIME_ZONE, now);
    if (local.minutesOfDay < QUIET.from || local.minutesOfDay >= QUIET.to) continue;
    const { rows: vans } = await pool.query('SELECT id FROM vans WHERE company_id = $1', [c.id]);
    for (const v of vans) sent += await evaluateVan(c.id, v.id, { today: local.date }).catch((e) => { logSweepError(e); return 0; });
    if (c.odometer_reminder_days) sent += await remindOdometer(c.id, c.odometer_reminder_days, local.date).catch((e) => { logSweepError(e); return 0; });
  }
  return sent;
}

module.exports = {
  BUILTINS, createBuiltins, getSettings, putSettings, getVanMaintenance, listDue, addItem, updateItem, deleteItem,
  markDone, history, setVanReminders, addEntry, updateEntry, listEntries, myFuel, evaluateVan, runFleetReminders, itemState,
};
