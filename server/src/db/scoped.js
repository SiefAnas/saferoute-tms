// Tenant-scoped data accessor — the app-layer half of the multi-tenancy guarantee
// (the DB-layer half is the Step-1 composite FKs). Every read/write through this
// accessor is forced to filter by the caller's tenant column, and inserts are
// stamped with it. Handlers get `req.db` (this) and never touch the raw pool,
// so an unscoped query is structurally impossible rather than merely discouraged.

class ScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScopeError';
    this.status = 403;
  }
}

// role -> which tenant this user lives in (§5.1). Never both.
function tenantTypeForRole(role) {
  if (role === 'driver' || role === 'company_admin' || role === 'parent') return 'company';
  if (role === 'school_admin' || role === 'school_staff') return 'school';
  throw new ScopeError(`unknown role: ${role}`);
}

// Per-table tenant column, by tenant type. 'id' marks the tenant root table itself.
// A table missing an entry for the caller's tenant type is NOT accessible to them.
const TABLE_SCOPE = {
  companies: { company: 'id' },
  schools: { school: 'id' },
  users: { company: 'company_id', school: 'school_id' },
  vans: { company: 'company_id' },
  students: { company: 'company_id', school: 'school_id' }, // dual-tenant
  sessions: { company: 'company_id' },
  trips: { company: 'company_id', school: 'school_id' }, // dual-tenant
  assignments: { company: 'company_id' },
  staff_student_access: { school: 'school_id' },
  pay_rules: { company: 'company_id' },
  pay_adjustments: { company: 'company_id' },
  student_contacts: { company: 'company_id', school: 'school_id' }, // dual-tenant, like students
  assignment_schedule_overrides: { company: 'company_id' }, // scoped like its parent assignments
  parent_students: { company: 'company_id' }, // parent belongs to company, like driver
  pickup_skips: { company: 'company_id' },
  pickup_no_shows: { company: 'company_id' },
  schedule_changes: { company: 'company_id', school: 'school_id' }, // dual-tenant, like trips
};

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s) => {
  if (typeof s !== 'string' || !IDENT.test(s)) throw new ScopeError(`unsafe identifier: ${s}`);
  return `"${s}"`;
};

function scopeColumn(table, tenantType) {
  const entry = TABLE_SCOPE[table];
  if (!entry) throw new ScopeError(`unknown table: ${table}`);
  const col = entry[tenantType];
  if (!col) throw new ScopeError(`table "${table}" is not accessible to ${tenantType}-scoped users`);
  return col;
}

/**
 * @param pool     pg Pool
 * @param tenant   { type: 'company'|'school', id }
 * @param actor    { userId, role }
 */
function createScopedDb(pool, tenant, actor) {
  // Build the WHERE fragment: always tenant, optionally an ownership sub-scope
  // (e.g. driver -> own rows), optionally extra equality filters.
  // ownerIn implements a whitelisted subquery sub-scope, e.g. school_staff limited to their
  // granted students: student_id IN (SELECT student_id FROM staff_student_access WHERE
  // staff_user_id = $me). All identifiers are validated; the match value is parameterized.
  const buildWhere = (table, { where = {}, owner = null, ownerIn = null } = {}) => {
    const col = scopeColumn(table, tenant.type);
    const clauses = [`${ident(col)} = $1`];
    const values = [tenant.id];
    if (owner) {
      values.push(owner.value);
      clauses.push(`${ident(owner.column)} = $${values.length}`);
    }
    if (ownerIn) {
      const subClauses = [];
      for (const [k, v] of Object.entries(ownerIn.match)) {
        values.push(v);
        subClauses.push(`${ident(k)} = $${values.length}`);
      }
      clauses.push(
        `${ident(ownerIn.column)} IN (SELECT ${ident(ownerIn.refColumn)} FROM ${ident(ownerIn.table)} WHERE ${subClauses.join(' AND ')})`
      );
    }
    for (const [k, v] of Object.entries(where)) {
      values.push(v);
      clauses.push(`${ident(k)} = $${values.length}`);
    }
    return { clause: clauses.join(' AND '), values };
  };

  return {
    tenant,
    actor,

    async findMany(table, opts = {}) {
      const { clause, values } = buildWhere(table, opts);
      let sql = `SELECT * FROM ${ident(table)} WHERE ${clause}`;
      if (opts.orderBy) sql += ` ORDER BY ${ident(opts.orderBy)}`;
      if (opts.limit) {
        values.push(opts.limit);
        sql += ` LIMIT $${values.length}`;
      }
      return (await pool.query(sql, values)).rows;
    },

    // Returns the row only if it's inside the caller's scope; otherwise null
    // (so a foreign id reads as "not found", never leaking existence).
    async findById(table, id, opts = {}) {
      const rows = await this.findMany(table, { ...opts, where: { ...(opts.where || {}), id } });
      return rows[0] ?? null;
    },

    async insert(table, data) {
      const col = scopeColumn(table, tenant.type);
      if (col === 'id') throw new ScopeError(`cannot insert tenant-root table "${table}" via scoped db`);
      const row = { ...data, [col]: tenant.id }; // stamp tenant, overriding any client-supplied value
      const cols = Object.keys(row);
      const values = Object.values(row);
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const sql =
        `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) ` +
        `VALUES (${placeholders.join(', ')}) RETURNING *`;
      return (await pool.query(sql, values)).rows[0];
    },

    async update(table, id, data, opts = {}) {
      const col = scopeColumn(table, tenant.type);
      const sets = [];
      const values = [];
      for (const [k, v] of Object.entries(data)) {
        values.push(v);
        sets.push(`${ident(k)} = $${values.length}`);
      }
      values.push(id);
      const idP = values.length;
      values.push(tenant.id);
      const tenantP = values.length;
      let sql = `UPDATE ${ident(table)} SET ${sets.join(', ')} WHERE ${ident('id')} = $${idP} AND ${ident(col)} = $${tenantP}`;
      if (opts.owner) {
        values.push(opts.owner.value);
        sql += ` AND ${ident(opts.owner.column)} = $${values.length}`;
      }
      // Extra equality guards, e.g. { status: 'pending' } to make an update conditional on
      // the row not having moved out from under the caller (a concurrent sweep/other writer).
      // A guard that doesn't match returns null (not found) rather than clobbering the row.
      if (opts.where) {
        for (const [k, v] of Object.entries(opts.where)) {
          values.push(v);
          sql += ` AND ${ident(k)} = $${values.length}`;
        }
      }
      sql += ' RETURNING *';
      return (await pool.query(sql, values)).rows[0] ?? null;
    },

    async remove(table, id, opts = {}) {
      const col = scopeColumn(table, tenant.type);
      const values = [id, tenant.id];
      let sql = `DELETE FROM ${ident(table)} WHERE ${ident('id')} = $1 AND ${ident(col)} = $2`;
      if (opts.owner) {
        values.push(opts.owner.value);
        sql += ` AND ${ident(opts.owner.column)} = $${values.length}`;
      }
      sql += ' RETURNING id';
      return (await pool.query(sql, values)).rows[0] ?? null;
    },
  };
}

module.exports = { createScopedDb, tenantTypeForRole, scopeColumn, ScopeError, TABLE_SCOPE };
