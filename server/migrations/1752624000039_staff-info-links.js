/* eslint-disable camelcase */
// Staff info by link (branch staff-info-links). The company admin makes a link for drivers or for
// monitors; people fill in a public form; the admin reviews and approves each one.
//
//  - staff_links: one row per link. Only the SHA-256 hash of the code is stored (the raw code is
//    shown to the admin once, in the link). code_hint is the code's last 4 characters, so the
//    admin can tell links apart. max_submissions is copied from config when the link is made.
//    A link takes submissions while revoked_at IS NULL and expires_at > now().
//  - staff_submissions: what the public form sends, and nothing else. The form never writes to
//    users or vans; only "Approve" does. edit_token_hash lets the person who sent a row edit it
//    (only while status = 'new'; opening it in the admin's list moves it to 'seen').
//  - account_setup_tokens: the one-time "choose your password" link from the approval email.
//    Hashed, 24 hours, single use.
// The vans table is not changed.
exports.up = (pgm) => {
  pgm.createTable('staff_links', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    company_id: { type: 'uuid', notNull: true, references: 'companies(id)', onDelete: 'CASCADE' },
    role: { type: 'text', notNull: true },
    code_hash: { type: 'text', notNull: true },
    code_hint: { type: 'text', notNull: true },
    max_submissions: { type: 'integer', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
    created_by_user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('staff_links', 'staff_links_role_check', { check: "role IN ('driver', 'monitor')" });
  pgm.addConstraint('staff_links', 'staff_links_max_check', { check: 'max_submissions BETWEEN 1 AND 10000' });
  pgm.addConstraint('staff_links', 'staff_links_code_hash_uniq', { unique: ['code_hash'] });
  pgm.addConstraint('staff_links', 'staff_links_id_company_id_uniq', { unique: ['id', 'company_id'] });
  pgm.createIndex('staff_links', ['company_id', 'role']);

  pgm.createTable('staff_submissions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    company_id: { type: 'uuid', notNull: true },
    link_id: { type: 'uuid', notNull: true },
    role: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'new' },
    full_name: { type: 'text', notNull: true },
    phone: { type: 'text', notNull: true },
    email: { type: 'text', notNull: true },
    van_plate: { type: 'text' },
    van_make: { type: 'text' },
    van_model: { type: 'text' },
    van_color: { type: 'text' },
    van_year: { type: 'integer' },
    edit_token_hash: { type: 'text', notNull: true },
    seen_at: { type: 'timestamptz' },
    seen_by_user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    decided_at: { type: 'timestamptz' },
    decided_by_user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    approved_user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    approved_van_id: { type: 'uuid', references: 'vans(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('staff_submissions', 'staff_submissions_link_fk', {
    foreignKeys: { columns: ['link_id', 'company_id'], references: 'staff_links(id, company_id)', onDelete: 'CASCADE' },
  });
  pgm.addConstraint('staff_submissions', 'staff_submissions_status_check', { check: "status IN ('new', 'seen', 'approved', 'rejected')" });
  pgm.addConstraint('staff_submissions', 'staff_submissions_role_check', { check: "role IN ('driver', 'monitor')" });
  pgm.addConstraint('staff_submissions', 'staff_submissions_ranges', { check: 'van_year IS NULL OR van_year BETWEEN 1900 AND 2100' });
  pgm.addConstraint('staff_submissions', 'staff_submissions_edit_token_uniq', { unique: ['edit_token_hash'] });
  pgm.createIndex('staff_submissions', ['company_id', 'created_at']);
  pgm.createIndex('staff_submissions', 'link_id');
  pgm.sql('CREATE TRIGGER trg_staff_submissions_updated_at BEFORE UPDATE ON "staff_submissions" FOR EACH ROW EXECUTE FUNCTION set_updated_at();');

  pgm.createTable('account_setup_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    token_hash: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('account_setup_tokens', 'account_setup_tokens_hash_uniq', { unique: ['token_hash'] });
  pgm.createIndex('account_setup_tokens', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('account_setup_tokens');
  pgm.dropTable('staff_submissions');
  pgm.dropTable('staff_links');
};
