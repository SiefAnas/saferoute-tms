/* eslint-disable camelcase */
// Auth for real users (branch auth-accounts). Additive only.
//  - users.must_change_password: set when an admin creates or resets an account with a
//    generated temporary password; the user must choose their own before using the app.
//  - users.password_changed_at: tokens issued before this moment are rejected, so a password
//    change or reset signs out old sessions.
//  - password_reset_tokens: "forgot password" links. Only the SHA-256 of the token is stored;
//    each token is single-use (used_at) and time-limited (expires_at).
exports.up = (pgm) => {
  pgm.addColumns('users', {
    must_change_password: { type: 'boolean', notNull: true, default: false },
    password_changed_at: { type: 'timestamptz' },
  });

  pgm.createTable('password_reset_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    token_hash: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('password_reset_tokens', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('password_reset_tokens');
  pgm.dropColumns('users', ['must_change_password', 'password_changed_at']);
};
