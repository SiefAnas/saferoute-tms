/* eslint-disable camelcase */
// STEP — Driver page task: address + license number fields on users (driver-facing, but
// generic columns so any role could use them later), and a direct student<->driver link
// on the Students page.
//
// ASSUMPTION (flagged for confirmation): students.driver_user_id mirrors the exact pattern
// already shipped for vans.driver_user_id (migration 013) — a simple, direct "assigned
// driver" tag, separate from the operational `assignments` table (which stays authoritative
// for actual daily pickup/dropoff scheduling, the driver's own schedule, payroll, and the
// parent dashboard's vehicle/driver display). Chose this because it's the same shape Anas
// already approved for the Fleet page; if he actually meant "wire this into the real
// Assignments system," that's a different, bigger change.

exports.up = (pgm) => {
  pgm.addColumns('users', {
    address: { type: 'text' },
    license_number: { type: 'text' },
  });

  pgm.addColumn('students', {
    driver_user_id: { type: 'uuid' },
  });
  pgm.addConstraint('students', 'students_driver_company_fk', {
    foreignKeys: {
      columns: ['driver_user_id', 'company_id'],
      references: 'users(id, company_id)',
      onDelete: 'RESTRICT',
    },
  });
  pgm.createIndex('students', 'driver_user_id');
};

exports.down = (pgm) => {
  pgm.dropConstraint('students', 'students_driver_company_fk');
  pgm.dropColumn('students', 'driver_user_id');
  pgm.dropColumn('users', 'license_number');
  pgm.dropColumn('users', 'address');
};
