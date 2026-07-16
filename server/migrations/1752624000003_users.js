/* eslint-disable camelcase */
// STEP 1 — Users: 4 roles, one account = one role = one org (§5.1, §6).
// THE core multi-tenancy guard lives here: a CHECK ties each role to exactly ONE tenant column,
// making a cross-tenant misassignment impossible to insert (the highest-risk part per §4/§11).

const uuidPk = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
const withTimestamps = (pgm) => ({
  created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
});

exports.up = (pgm) => {
  pgm.createTable('users', {
    id: uuidPk(pgm),
    email: { type: 'text', notNull: true },
    password_hash: { type: 'text', notNull: true },
    full_name: { type: 'text', notNull: true },
    phone: { type: 'text' },
    role: { type: 'text', notNull: true },
    // Exactly one of these is set — enforced by users_tenant_scope_check below.
    company_id: { type: 'uuid', references: 'companies(id)', onDelete: 'RESTRICT' },
    school_id: { type: 'uuid', references: 'schools(id)', onDelete: 'RESTRICT' },
    is_active: { type: 'boolean', notNull: true, default: true },
    ...withTimestamps(pgm),
  });

  pgm.addConstraint('users', 'users_role_check', {
    check: "role IN ('driver','company_admin','school_admin','school_staff')",
  });

  // One account = one role = one org (§5.1):
  //   company-side roles  -> company_id set, school_id null
  //   school-side roles   -> school_id set,  company_id null
  pgm.addConstraint('users', 'users_tenant_scope_check', {
    check: `(
      (role IN ('driver','company_admin')      AND company_id IS NOT NULL AND school_id IS NULL)
      OR
      (role IN ('school_admin','school_staff')  AND school_id  IS NOT NULL AND company_id IS NULL)
    )`,
  });

  // Case-insensitive unique email — one shared login page for all roles (§5.1).
  pgm.sql('CREATE UNIQUE INDEX users_email_lower_uniq ON users (lower(email));');

  pgm.createIndex('users', 'company_id');
  pgm.createIndex('users', 'school_id');
  pgm.createIndex('users', 'role');
  pgm.sql('CREATE INDEX users_full_name_trgm_idx ON users USING gin (full_name gin_trgm_ops);');

  pgm.sql(
    'CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON "users" ' +
      'FOR EACH ROW EXECUTE FUNCTION set_updated_at();'
  );

  // Composite-unique targets so child tables can pin their denormalized tenant id to this user
  // via a composite FK (defense-in-depth tenant consistency — see sessions/assignments/pay_*).
  pgm.addConstraint('users', 'users_id_company_id_uniq', { unique: ['id', 'company_id'] });
  pgm.addConstraint('users', 'users_id_school_id_uniq', { unique: ['id', 'school_id'] });

  // Now that users exists, wire the placeholder-creator FKs on the tenant tables (§5.3).
  pgm.addConstraint('companies', 'companies_created_by_fk', {
    foreignKeys: { columns: 'created_by_user_id', references: 'users(id)', onDelete: 'SET NULL' },
  });
  pgm.addConstraint('schools', 'schools_created_by_fk', {
    foreignKeys: { columns: 'created_by_user_id', references: 'users(id)', onDelete: 'SET NULL' },
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('schools', 'schools_created_by_fk');
  pgm.dropConstraint('companies', 'companies_created_by_fk');
  pgm.dropTable('users');
};
