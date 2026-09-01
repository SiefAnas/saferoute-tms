// User management (§5.2): a company_admin creates drivers and parents; a school_admin
// creates school_staff. All within the creator's tenant. Admin-created accounts are
// vouched-for, so we stamp email_verified_at at creation — this upholds the requireOperable
// invariant (every operational user must be verified).
//
// Permission-changes task (2026-08-25): company_admin can no longer create another
// company_admin, and school_admin can no longer create another school_admin — the task's
// spec enumerated exactly what each admin role may create ("driver accounts, parent
// accounts" / "school staff accounts only") and neither list includes the admin's own role.
// ASSUMPTION, flagged for confirmation: this is a real behavior change from before (both
// were previously self-creatable); no existing test asserted the old behavior, so nothing
// broke, but worth double-checking this was the intent.
const { hashPassword } = require('../auth/password');
const { HttpError } = require('../errors');
const { assertValidEmail, assertPasswordStrength, assertMaxLength } = require('../validate');

// Which roles a given admin role may create (same tenant side).
const CREATABLE = {
  company_admin: ['driver', 'parent'],
  school_admin: ['school_staff'],
};

async function createUser(req, body = {}) {
  const { email, password, fullName, role, phone, address, licenseNumber } = body;
  const allowed = CREATABLE[req.auth.role];
  if (!allowed) throw new HttpError(403, 'your role cannot create users');
  if (!email || !password || !fullName || !role) {
    throw new HttpError(400, 'email, password, fullName and role are required');
  }
  assertValidEmail(email);
  assertPasswordStrength(password);
  assertMaxLength(fullName, 200, 'fullName');
  assertMaxLength(phone, 30, 'phone');
  assertMaxLength(address, 300, 'address');
  assertMaxLength(licenseNumber, 50, 'licenseNumber');
  if (!allowed.includes(role)) {
    throw new HttpError(403, `a ${req.auth.role} cannot create a ${role}`);
  }
  // Phone/address/license used to be optional for a driver account — no longer (§7 item 6):
  // the Add Driver form collects all three and now marks them required, so enforce the same
  // here rather than leaving it a client-only rule. school_staff creation doesn't collect
  // these fields at all, so this stays scoped to driver/parent.
  if (role === 'driver') {
    if (!phone) throw new HttpError(400, 'phone is required for a driver account');
    if (!address) throw new HttpError(400, 'address is required for a driver account');
    if (!licenseNumber) throw new HttpError(400, 'licenseNumber is required for a driver account');
  }
  // Parent phone/address (added for the parent<->student auto-match suggestion task,
  // 2026-09-01): the Add Parent form now collects both, and the match logic works far better
  // with real data to compare against, so required here too rather than left optional.
  if (role === 'parent') {
    if (!phone) throw new HttpError(400, 'phone is required for a parent account');
    if (!address) throw new HttpError(400, 'address is required for a parent account');
  }

  // Passwords set here are real, permanent passwords the admin chooses — not a temporary
  // value forcing a first-login reset. No such forced-change mechanism exists anywhere in
  // this app (checked: no must_change_password-style flag on users, no reset-on-first-login
  // code path); the account can just log in with whatever's set here.
  const password_hash = await hashPassword(password);
  try {
    // req.db stamps the caller's tenant column (company_id or school_id); the DB CHECK
    // guarantees role matches that column. email_verified_at stamped now (admin-vouched).
    // created_by_user_id records who created this account — the only admin who may later
    // edit its password/email/profile info (see updateUser below).
    const row = await req.db.insert('users', {
      email,
      password_hash,
      full_name: fullName,
      role,
      phone: phone ?? null,
      address: address ?? null,
      license_number: licenseNumber ?? null,
      email_verified_at: new Date().toISOString(),
      created_by_user_id: req.auth.userId,
    });
    return publicUser(row);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'email already registered');
    throw err;
  }
}

async function listUsers(req, { role } = {}) {
  const where = role ? { role } : {};
  const rows = await req.db.findMany('users', { where, orderBy: 'full_name' });
  return rows.map(publicUser);
}

async function getUser(req, id) {
  const row = await req.db.findById('users', id);
  if (!row) throw new HttpError(404, 'user not found');
  return publicUser(row);
}

// Creator-only edit (task requirement): only the admin who created an account may change
// its password, email, or profile info (full_name/phone/is_active). Driver/parent/
// school_staff have no self-edit route at all — the adminsOnly gate on the router already
// keeps them off this endpoint entirely, so there's nothing further to remove there; this
// check is the "only the CREATING admin, not just any admin in the tenant" half.
//
// ASSUMPTION, flagged for confirmation: rows with created_by_user_id = NULL (every account
// that existed before this feature, plus any future self-serve company_admin/school_admin
// signup, which has no creating admin) are grandfathered — editable by any admin in the same
// tenant, the pre-existing behavior — rather than uneditable by anyone. Locking those out
// entirely would silently strand real accounts (the seeded drivers/staff, Jamie, etc.) with
// no path to being edited at all.
async function updateUser(req, id, body = {}) {
  const existing = await req.db.findById('users', id);
  if (!existing) throw new HttpError(404, 'user not found');
  if (existing.created_by_user_id && existing.created_by_user_id !== req.auth.userId) {
    throw new HttpError(403, 'only the admin who created this account can edit it');
  }

  const patch = {};
  for (const key of ['full_name', 'phone', 'is_active', 'address', 'license_number']) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (body.email !== undefined) {
    assertValidEmail(body.email);
    patch.email = body.email;
  }
  if (body.password !== undefined) {
    assertPasswordStrength(body.password);
    patch.password_hash = await hashPassword(body.password);
  }
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'nothing to update');
  assertMaxLength(patch.full_name, 200, 'full_name');
  assertMaxLength(patch.phone, 30, 'phone');
  assertMaxLength(patch.address, 300, 'address');
  assertMaxLength(patch.license_number, 50, 'license_number');

  try {
    const row = await req.db.update('users', id, patch);
    if (!row) throw new HttpError(404, 'user not found');
    return publicUser(row);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'email already registered');
    throw err;
  }
}

// Never leak password_hash.
function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    role: u.role,
    phone: u.phone,
    address: u.address ?? null,
    license_number: u.license_number ?? null,
    is_active: u.is_active,
    email_verified_at: u.email_verified_at,
    created_by_user_id: u.created_by_user_id ?? null,
  };
}

module.exports = { createUser, listUsers, getUser, updateUser };
