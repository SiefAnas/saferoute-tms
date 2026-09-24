/* eslint-disable camelcase */
// Monitor role (branch monitor-role). A monitor rides in the van with a driver and only checks in
// and out for their hours. Company-side role, created by the company admin like a driver.
//  - users: 'monitor' joins the company-scoped roles.
//  - monitor_assignments: which driver a monitor rides with, on which weekdays and shift. One row
//    per monitor (keep it simple: a monitor rides with one driver at a time); editing replaces it.
// Monitors check in and out on the existing `sessions` table, and are paid from `pay_rules` /
// `pay_adjustments` like drivers (those tables key on a company user id).
exports.up = (pgm) => {
  pgm.dropConstraint('users', 'users_role_check');
  pgm.addConstraint('users', 'users_role_check', {
    check: "role IN ('driver','company_admin','school_admin','school_staff','parent','monitor')",
  });
  pgm.dropConstraint('users', 'users_tenant_scope_check');
  pgm.addConstraint('users', 'users_tenant_scope_check', {
    check: `(
      (role IN ('driver','company_admin','parent','monitor') AND company_id IS NOT NULL AND school_id IS NULL)
      OR
      (role IN ('school_admin','school_staff')                AND school_id  IS NOT NULL AND company_id IS NULL)
    )`,
  });

  pgm.createTable('monitor_assignments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    company_id: { type: 'uuid', notNull: true },
    monitor_user_id: { type: 'uuid', notNull: true, unique: true },
    driver_user_id: { type: 'uuid', notNull: true },
    days_of_week: { type: 'smallint[]', notNull: true, default: pgm.func("'{1,2,3,4,5}'::smallint[]") },
    shift_period: { type: 'text', notNull: true, default: 'both' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('monitor_assignments', 'monitor_assignments_monitor_fk', {
    foreignKeys: { columns: ['monitor_user_id', 'company_id'], references: 'users(id, company_id)', onDelete: 'CASCADE' },
  });
  pgm.addConstraint('monitor_assignments', 'monitor_assignments_driver_fk', {
    foreignKeys: { columns: ['driver_user_id', 'company_id'], references: 'users(id, company_id)', onDelete: 'CASCADE' },
  });
  pgm.addConstraint('monitor_assignments', 'monitor_assignments_days_check', {
    check: "cardinality(days_of_week) > 0 AND days_of_week <@ '{1,2,3,4,5,6,7}'::smallint[]",
  });
  pgm.addConstraint('monitor_assignments', 'monitor_assignments_shift_check', {
    check: "shift_period IN ('morning', 'afternoon', 'both')",
  });
  pgm.createIndex('monitor_assignments', 'driver_user_id');
  pgm.sql(
    'CREATE TRIGGER trg_monitor_assignments_updated_at BEFORE UPDATE ON "monitor_assignments" ' +
      'FOR EACH ROW EXECUTE FUNCTION set_updated_at();'
  );
};

exports.down = (pgm) => {
  pgm.dropTable('monitor_assignments');
  pgm.dropConstraint('users', 'users_tenant_scope_check');
  pgm.addConstraint('users', 'users_tenant_scope_check', {
    check: `(
      (role IN ('driver','company_admin','parent') AND company_id IS NOT NULL AND school_id IS NULL)
      OR
      (role IN ('school_admin','school_staff')      AND school_id  IS NOT NULL AND company_id IS NULL)
    )`,
  });
  pgm.dropConstraint('users', 'users_role_check');
  pgm.addConstraint('users', 'users_role_check', {
    check: "role IN ('driver','company_admin','school_admin','school_staff','parent')",
  });
};
