/* eslint-disable camelcase */
// STEP — New `parent` role + account-ownership/permission changes (task: "parent role +
// permission changes"). Three things:
//   1. `parent` joins the company-scoped role group (created by company_admin, same as
//      driver) — one parent account can link to MANY students via the new parent_students
//      join table (mirrors staff_student_access's shape/constraints exactly).
//   2. `users.created_by_user_id` — who created this account. Used to enforce "only the
//      admin who created an account may edit its password/email/profile" (app-layer check
//      in services/users.js). NULL for self-serve company_admin/school_admin signups (no
//      creator) and for any pre-existing row from before this migration — see the app-layer
//      comment for how NULL is handled (grandfathered, not locked out).
//   3. `pickup_skips` — one row per (student, calendar date) a parent skips morning pickup
//      for. Real feature (not mockup): backs the Parent Dashboard's "Skip Today's Pickup"
//      button, which needs a genuine notification send, per the task's own explicit carve-out.

const uuidPk = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });

exports.up = (pgm) => {
  // --- 1. Role check + tenant scope: add 'parent' to the company-scoped group ---
  pgm.dropConstraint('users', 'users_role_check');
  pgm.addConstraint('users', 'users_role_check', {
    check: "role IN ('driver','company_admin','school_admin','school_staff','parent')",
  });

  pgm.dropConstraint('users', 'users_tenant_scope_check');
  pgm.addConstraint('users', 'users_tenant_scope_check', {
    check: `(
      (role IN ('driver','company_admin','parent') AND company_id IS NOT NULL AND school_id IS NULL)
      OR
      (role IN ('school_admin','school_staff')      AND school_id  IS NOT NULL AND company_id IS NULL)
    )`,
  });

  // --- 2. Creator tracking, for creator-only edit rights ---
  pgm.addColumn('users', {
    created_by_user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
  });

  // --- Parent <-> Student links (many-to-many). Company-scoped, like driver/parent
  // themselves — mirrors staff_student_access's composite-FK tenant-consistency pattern. ---
  pgm.createTable('parent_students', {
    id: uuidPk(pgm),
    parent_user_id: { type: 'uuid', notNull: true },
    student_id: { type: 'uuid', notNull: true },
    company_id: { type: 'uuid', notNull: true },
    created_by_user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('parent_students', 'ps_parent_company_fk', {
    foreignKeys: {
      columns: ['parent_user_id', 'company_id'],
      references: 'users(id, company_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('parent_students', 'ps_student_company_fk', {
    foreignKeys: {
      columns: ['student_id', 'company_id'],
      references: 'students(id, company_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('parent_students', 'ps_unique', { unique: ['parent_user_id', 'student_id'] });
  pgm.createIndex('parent_students', 'parent_user_id');
  pgm.createIndex('parent_students', 'student_id');
  pgm.createIndex('parent_students', 'company_id');

  // --- Skip-pickup log (real feature backing the Parent Dashboard's Skip button) ---
  pgm.createTable('pickup_skips', {
    id: uuidPk(pgm),
    company_id: { type: 'uuid', notNull: true },
    student_id: { type: 'uuid', notNull: true },
    parent_user_id: { type: 'uuid', notNull: true },
    skip_date: { type: 'date', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('pickup_skips', 'pickup_skips_student_company_fk', {
    foreignKeys: {
      columns: ['student_id', 'company_id'],
      references: 'students(id, company_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('pickup_skips', 'pickup_skips_parent_company_fk', {
    foreignKeys: {
      columns: ['parent_user_id', 'company_id'],
      references: 'users(id, company_id)',
      onDelete: 'CASCADE',
    },
  });
  // One skip per student per day — also doubles as the idempotency guard against double-submit.
  pgm.addConstraint('pickup_skips', 'pickup_skips_unique', { unique: ['student_id', 'skip_date'] });
  pgm.createIndex('pickup_skips', 'company_id');
  pgm.createIndex('pickup_skips', 'student_id');
};

exports.down = (pgm) => {
  pgm.dropTable('pickup_skips');
  pgm.dropTable('parent_students');
  pgm.dropColumn('users', 'created_by_user_id');

  pgm.dropConstraint('users', 'users_tenant_scope_check');
  pgm.addConstraint('users', 'users_tenant_scope_check', {
    check: `(
      (role IN ('driver','company_admin')      AND company_id IS NOT NULL AND school_id IS NULL)
      OR
      (role IN ('school_admin','school_staff')  AND school_id  IS NOT NULL AND company_id IS NULL)
    )`,
  });
  pgm.dropConstraint('users', 'users_role_check');
  pgm.addConstraint('users', 'users_role_check', {
    check: "role IN ('driver','company_admin','school_admin','school_staff')",
  });
};
