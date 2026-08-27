/* eslint-disable camelcase */
// STEP — Rework: the standalone driver_user_id tags on students (016) and vans (013) could
// silently disagree with the real assignments table (also student+driver+van), since they
// were two independent sources of truth for "who's driving." Per Anas's explicit direction
// after being flagged: remove both tags entirely. `assignments` is now the ONLY source of
// truth for "which driver is currently linked to this student/van" — see routes/students.js
// (Students page now creates/closes real Assignment rows) and client-side VansPage.tsx
// (Fleet page is now read-only, deriving "Driver" from today's active assignment using that
// van — no direct write path on Fleet at all, since "assign a driver to a van" would need a
// student too, which doesn't make sense as a van-level action).

exports.up = (pgm) => {
  pgm.dropConstraint('students', 'students_driver_company_fk');
  pgm.dropColumn('students', 'driver_user_id');
  pgm.dropConstraint('vans', 'vans_driver_company_fk');
  pgm.dropColumn('vans', 'driver_user_id');
};

exports.down = (pgm) => {
  pgm.addColumn('vans', { driver_user_id: { type: 'uuid' } });
  pgm.addConstraint('vans', 'vans_driver_company_fk', {
    foreignKeys: { columns: ['driver_user_id', 'company_id'], references: 'users(id, company_id)', onDelete: 'RESTRICT' },
  });
  pgm.createIndex('vans', 'driver_user_id');

  pgm.addColumn('students', { driver_user_id: { type: 'uuid' } });
  pgm.addConstraint('students', 'students_driver_company_fk', {
    foreignKeys: { columns: ['driver_user_id', 'company_id'], references: 'users(id, company_id)', onDelete: 'RESTRICT' },
  });
  pgm.createIndex('students', 'driver_user_id');
};
