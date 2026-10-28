/* eslint-disable camelcase */
// Public website (branch public-website): "Book a demo" on the Companies and Schools pages.
// One row per request; the admin inbox gets an email too (services/publicSite.js).
// audience says which page it came from. Nothing else reads or writes this table yet.
exports.up = (pgm) => {
  pgm.createTable('demo_requests', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    audience: { type: 'text', notNull: true },
    full_name: { type: 'text', notNull: true },
    email: { type: 'text', notNull: true },
    phone: { type: 'text' },
    organization: { type: 'text', notNull: true },
    message: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('demo_requests', 'demo_requests_audience_check', { check: "audience IN ('company', 'school')" });
  pgm.createIndex('demo_requests', 'created_at');
};

exports.down = (pgm) => {
  pgm.dropTable('demo_requests');
};
