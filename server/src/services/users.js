// User management (§5.2): a company_admin creates drivers (and company_admins);
// a school_admin creates school_staff (and school_admins). All within the creator's tenant.
// Admin-created accounts are vouched-for, so we stamp email_verified_at at creation — this
// upholds the requireOperable invariant (every operational user must be verified).
const { hashPassword } = require('../auth/password');
const { HttpError } = require('../errors');

// Which roles a given admin role may create (same tenant side).
const CREATABLE = {
  company_admin: ['driver', 'company_admin'],
  school_admin: ['school_staff', 'school_admin'],
};

async function createUser(req, body = {}) {
  const { email, password, fullName, role, phone } = body;
  const allowed = CREATABLE[req.auth.role];
  if (!allowed) throw new HttpError(403, 'your role cannot create users');
  if (!email || !password || !fullName || !role) {
    throw new HttpError(400, 'email, password, fullName and role are required');
  }
  if (!allowed.includes(role)) {
    throw new HttpError(403, `a ${req.auth.role} cannot create a ${role}`);
  }

  const password_hash = await hashPassword(password);
  try {
    // req.db stamps the caller's tenant column (company_id or school_id); the DB CHECK
    // guarantees role matches that column. email_verified_at stamped now (admin-vouched).
    const row = await req.db.insert('users', {
      email,
      password_hash,
      full_name: fullName,
      role,
      phone: phone ?? null,
      email_verified_at: new Date().toISOString(),
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

async function updateUser(req, id, body = {}) {
  const patch = {};
  for (const key of ['full_name', 'phone', 'is_active']) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'nothing to update');
  const row = await req.db.update('users', id, patch);
  if (!row) throw new HttpError(404, 'user not found');
  return publicUser(row);
}

// Never leak password_hash.
function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    role: u.role,
    phone: u.phone,
    is_active: u.is_active,
    email_verified_at: u.email_verified_at,
  };
}

module.exports = { createUser, listUsers, getUser, updateUser };
