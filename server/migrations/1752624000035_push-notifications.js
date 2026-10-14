/* eslint-disable camelcase */
// Push notifications foundation (branch push-notifications). Plumbing only: no feature sends yet.
//
//  - push_tokens: one row per device a user is signed in on (phone + tablet = two rows).
//      kind 'expo' = an Expo push token from the mobile app (ExponentPushToken[...]);
//      kind 'web'  = a browser Web Push subscription (token = its endpoint URL, keys in p256dh/auth).
//    token is unique: a device belongs to whoever signed in on it last, so a shared or handed-down
//    phone moves to the new user instead of notifying the old one.
//  - notifications: every notification, sent or waiting. send_at is when it goes out (now, or a
//    future time for reminders); status scheduled -> sending -> sent (or cancelled / failed).
//    read_at is the in-app read state. data is the JSON payload (data.route = screen to open).
//  - notification_deliveries: one row per device a notification was pushed to, with the push
//    service's answer, so a dead token can be found and removed and every send is on record.
// Users are never deleted (they are deactivated), so ON DELETE CASCADE only matters for tests.
exports.up = (pgm) => {
  pgm.createTable('push_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true },
    token: { type: 'text', notNull: true, unique: true },
    p256dh: { type: 'text' },
    auth: { type: 'text' },
    platform: { type: 'text' }, // 'ios' | 'android' | 'web' (informational)
    device_name: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('push_tokens', 'push_tokens_kind_check', {
    check: "kind IN ('expo', 'web') AND (kind <> 'web' OR (p256dh IS NOT NULL AND auth IS NOT NULL))",
  });
  pgm.createIndex('push_tokens', 'user_id');

  pgm.createTable('notifications', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    title: { type: 'text', notNull: true },
    body: { type: 'text', notNull: true },
    data: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    // Lets a feature find (and cancel) its own scheduled sends later, e.g. 'shift_reminder'.
    category: { type: 'text' },
    send_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    status: { type: 'text', notNull: true, default: 'scheduled' },
    claimed_at: { type: 'timestamptz' },
    sent_at: { type: 'timestamptz' },
    read_at: { type: 'timestamptz' },
    attempts: { type: 'smallint', notNull: true, default: 0 },
    last_error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('notifications', 'notifications_status_check', {
    check: "status IN ('scheduled', 'sending', 'sent', 'cancelled', 'failed')",
  });
  // The in-app list (newest sent first) and the unread count.
  pgm.createIndex('notifications', ['user_id', 'sent_at']);
  pgm.createIndex('notifications', 'user_id', { name: 'notifications_unread_idx', where: "status = 'sent' AND read_at IS NULL" });
  // The sweep's "what is due" lookup.
  pgm.createIndex('notifications', 'send_at', { name: 'notifications_due_idx', where: "status IN ('scheduled', 'sending')" });

  pgm.createTable('notification_deliveries', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    notification_id: { type: 'uuid', notNull: true, references: 'notifications(id)', onDelete: 'CASCADE' },
    push_token_id: { type: 'uuid', references: 'push_tokens(id)', onDelete: 'SET NULL' },
    kind: { type: 'text', notNull: true },
    // 'ok' accepted by the push service, 'error' refused; receipt_status is Expo's later answer.
    status: { type: 'text', notNull: true },
    error: { type: 'text' },
    ticket_id: { type: 'text' },
    receipt_status: { type: 'text' },
    receipt_checked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('notification_deliveries', 'notification_id');
  pgm.createIndex('notification_deliveries', 'created_at', { name: 'notification_deliveries_receipt_idx', where: 'ticket_id IS NOT NULL AND receipt_checked_at IS NULL' });
};

exports.down = (pgm) => {
  pgm.dropTable('notification_deliveries');
  pgm.dropTable('notifications');
  pgm.dropTable('push_tokens');
};
