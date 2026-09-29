/* eslint-disable camelcase */
// Bulk import + account lifecycle (docs/bulk-import-spec.md). Additive only.
//  - users.last_login_at: drives the account status shown to admins (Created / Never logged in / Active).
//  - users.temp_password_expires_at: a temporary password stops working after 7 days.
//  - users.email_bounced: set when mail to the address bounces; mail to it is then skipped.
//  - password_reset_log: who reset whose password, how, and when (admin reset, self service, import).
//  - import_mappings: the column mapping an org used last time, per import type.
exports.up = (pgm) => {
  pgm.addColumns('users', {
    last_login_at: { type: 'timestamptz' },
    temp_password_expires_at: { type: 'timestamptz' },
    email_bounced: { type: 'boolean', notNull: true, default: false },
  });

  pgm.createTable('password_reset_log', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    actor_user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    target_user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    method: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('password_reset_log', 'password_reset_log_method_check', {
    check: "method IN ('admin_reset','self_service','import')",
  });
  pgm.createIndex('password_reset_log', 'target_user_id');

  pgm.createTable('import_mappings', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_type: { type: 'text', notNull: true },
    tenant_id: { type: 'uuid', notNull: true },
    import_type: { type: 'text', notNull: true },
    mapping: { type: 'jsonb', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('import_mappings', 'import_mappings_unique', {
    unique: ['tenant_type', 'tenant_id', 'import_type'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('import_mappings');
  pgm.dropTable('password_reset_log');
  pgm.dropColumns('users', ['last_login_at', 'temp_password_expires_at', 'email_bounced']);
};
