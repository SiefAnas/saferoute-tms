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

const MAX_ROWS = 100;
const MAX_CELL = 500;
// Random 12-character temporary passwords that must be replaced at first login: a cheaper bcrypt
// cost keeps a 100-row import to a few seconds without weakening anything that matters.
const TEMP_HASH_ROUNDS = 10;

const f = (key, label, required = false) => ({ key, label, required });

// `required` marks what a NEW record needs; an update only checks the fields that are present.
const TYPES = {
  drivers: { label: 'Drivers', side: 'company', role: 'driver', key: 'email', fields: [f('full_name', 'Full name', true), f('email', 'Email', true), f('phone', 'Phone'), f('address', 'Address'), f('license_number', 'License number')] },
  monitors: { label: 'Monitors', side: 'company', role: 'monitor', key: 'email', fields: [f('full_name', 'Full name', true), f('email', 'Email', true), f('phone', 'Phone'), f('address', 'Address')] },
  parents: { label: 'Parents', side: 'company', role: 'parent', key: 'email', fields: [f('full_name', 'Full name', true), f('email', 'Email', true), f('phone', 'Phone', true), f('address', 'Address', true)] },
  vans: { label: 'Vans', side: 'company', key: 'license_plate', fields: [f('license_plate', 'License plate', true), f('brand', 'Brand', true), f('model', 'Model', true), f('year', 'Year', true), f('color', 'Color', true), f('number', 'Van number')] },
  students: {
    label: 'Students', side: 'company', key: 'Student ID + school (else name + school)',
    fields: [f('full_name', 'Student name', true), f('school', 'School (exact name)', true), f('student_id', 'Student ID'), f('grade', 'Grade', true), f('age', 'Age', true), f('parent_name', 'Parent name', true), f('parent_phone', 'Parent phone', true), f('parent_email', 'Parent email'), f('street_address', 'Street address', true), f('city', 'City', true), f('state', 'State (2 letters)', true), f('zip_code', 'Zip code', true), f('notes', 'Notes')],
  },
  staff: { label: 'School staff', side: 'school', role: 'school_staff', key: 'email', fields: [f('full_name', 'Full name', true), f('email', 'Email', true), f('phone', 'Phone')] },
};

const TYPES_BY_ROLE = {
  company_admin: ['drivers', 'monitors', 'parents', 'vans', 'students'],
  school_admin: ['staff'],
};

function typesFor(role) {
  return (TYPES_BY_ROLE[role] ?? []).map((id) => ({ id, label: TYPES[id].label, match_key: TYPES[id].key, fields: TYPES[id].fields }));
}

function assertCanImport(req, type) {
  const def = TYPES[type];
  if (!def) throw new HttpError(400, 'choose what you are importing: drivers, monitors, parents, vans, students or staff');
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
async function updateFields(client, table, id, tenantCol, tenantId, patch) {
  const keys = Object.keys(patch).filter((k) => patch[k] !== '' && patch[k] !== undefined);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `"${k}" = $${i + 3}`);
  await client.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1 AND ${tenantCol} = $2`, [id, tenantId, ...keys.map((k) => patch[k])]);
}

async function execPerson(req, def, plan, credentials) {
  const { row } = plan;
  const tenantCol = def.side === 'company' ? 'company_id' : 'school_id';
  if (plan.action === 'update') {
    // Only this type's own fields (each field key is the users column of the same name), minus the
    // email it was matched on. A field the type doesn't list is never written, so importing staff
    // (no address field) can't touch their address, and adding a field to a type later needs no
    // change here.
    const patch = Object.fromEntries(def.fields.filter((fd) => fd.key !== def.key).map((fd) => [fd.key, row[fd.key]]));
    await withTx((c) => updateFields(c, 'users', plan.existingId, tenantCol, req.auth.tenantId, patch));
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

async function execVan(req, plan) {
  const { row } = plan;
  const patch = { license_plate: row.license_plate, brand: row.brand, model: row.model, color: row.color, number: row.number, year: row.year ? Number(row.year) : '' };
  if (plan.action === 'update') {
    await withTx((c) => updateFields(c, 'vans', plan.existingId, 'company_id', req.auth.tenantId, patch));
    return;
  }
  await pool.query(
    'INSERT INTO vans (company_id, license_plate, brand, model, year, color, number) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [req.auth.tenantId, row.license_plate, row.brand, row.model, Number(row.year), row.color, row.number || null]
  );
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
    const missing = missingRequired(def, r);
    if (missing.length) return err(p, `Missing: ${missing.join(', ')}`);
    if (!/^\d{1,2}$/.test(r.age) || +r.age > 25) return err(p, 'Age must be a whole number from 0 to 25');
    try { assertValidZip(r.zip_code); } catch { return err(p, 'Zip code must be a valid US zip, like 60601'); }
    try { r.state = assertValidState(r.state); } catch { return err(p, 'State must be a 2-letter US state code, like IL'); }
    if (r.parent_email) {
      try { assertValidEmail(r.parent_email); } catch { return err(p, `"${r.parent_email}" is not a valid parent email address`); }
    }
    if (r.student_id.length > 50) return err(p, 'Student ID must be 50 characters or fewer');
    const matches = schoolsByName.get(lc(r.school));
    if (!matches) return err(p, `School "${r.school}" was not found. Add the school first, then import the students.`);
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
    if (p.row.parent_email) {
      const k = lc(p.row.parent_email);
      const u = parents.get(k);
      if (u) {
        if (u.company_id !== req.auth.tenantId) { err(p, 'The parent email is already registered to another account.'); continue; }
        if (u.role !== 'parent') { err(p, `The parent email belongs to a ${u.role.replace('_', ' ')} account, not a parent.`); continue; }
        if (!u.is_active) { err(p, 'The parent account is deactivated.'); continue; }
      } else if (!willCreate.has(k)) {
        willCreate.add(k);
        p.note = 'Also creates a parent account';
      }
    }
  }
  return plans;
}

async function execStudent(req, def, plan, credentials) {
  const { row } = plan;
  return withTx(async (c) => {
    const tenantId = req.auth.tenantId;
    let studentId = plan.existingId;
    const fields = {
      grade: row.grade, age: Number(row.age), parent_name: row.parent_name, parent_phone: row.parent_phone,
      street_address: row.street_address, city: row.city, state: row.state, zip_code: row.zip_code, notes: row.notes || 'None',
    };
    if (plan.action === 'update') {
      await updateFields(c, 'students', studentId, 'company_id', tenantId, {
        full_name: row.full_name,
        ...fields,
        // Only when the preview said so (an existing student getting their first ID); an ID match
        // never rewrites the stored ID.
        ...(plan.attachStudentId ? { student_id: row.student_id } : {}),
      });
    } else {
      const { rows } = await c.query(
        `INSERT INTO students (company_id, school_id, full_name, grade, age, parent_name, parent_phone, street_address, city, state, zip_code, notes, student_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [tenantId, plan.schoolId, row.full_name, fields.grade, fields.age, fields.parent_name, fields.parent_phone, fields.street_address, fields.city, fields.state, fields.zip_code, fields.notes, row.student_id || null]
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
  if (type === 'students') return { def, plans: await planStudents(req, def, rows) };
  return { def, plans: await planPeople(req, def, rows) };
}

const countOf = (plans, action) => plans.filter((p) => p.action === action).length;

async function preview(req, type, rawRows) {
  const { plans } = await plan(req, type, rawRows);
  return {
    type,
    counts: { create: countOf(plans, 'create'), update: countOf(plans, 'update'), error: countOf(plans, 'error') },
    rows: plans.map((p, i) => ({ index: i, action: p.action, reason: p.reason ?? null, note: p.note ?? null })),
  };
}

function friendlyDbError(e) {
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
      else if (type === 'students') studentIds.set(i, await execStudent(req, def, p, credentials));
      else await execPerson(req, def, p, credentials);
      results.push({ index: i, status: p.action === 'create' ? 'created' : 'updated', reason: null });
    } catch (e) {
      if (!e.code) console.error('[import] row failed', e.message);
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

module.exports = { MAX_ROWS, typesFor, preview, commit, getMapping, saveMapping };
