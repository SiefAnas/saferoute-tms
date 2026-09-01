// One-off backfill (2026-09-01, §7 item 6): phone/address/license_number became required
// for driver accounts, and notes became required for students, but existing seeded rows
// predate that rule and were left with NULLs. Fills them in with the same values the updated
// seed-dummy-data.js would generate for a fresh seed, so the two stay consistent and the live
// app doesn't show blank/broken fields for data that already existed. Does not touch any
// row that already has a value — safe to re-run.
require('dotenv').config();
const pool = require('../src/db/pool.js');

async function main() {
  const drivers = await pool.query(
    "SELECT id, email, company_id FROM users WHERE role = 'driver' AND email ~ '^driver[0-9]+@company[0-9]+\\.com$' AND (phone IS NULL OR address IS NULL OR license_number IS NULL) ORDER BY email"
  );
  const driverStreets = [
    ['12 Birchwood Ln', '48 Cedar Ct'],
    ['205 Harbor View Dr', '77 Maple Ridge Rd'],
    ['9 Willow Creek Way', '331 Foxglove St'],
  ];
  for (const row of drivers.rows) {
    const m = row.email.match(/^driver(\d+)@company(\d+)\.com$/);
    const d = Number(m[1]) - 1;
    const c = Number(m[2]) - 1;
    const phone = `555-${2000 + c * 100 + d * 10}`;
    const address = `${driverStreets[c][d]}, Springfield, IL 62701`;
    const licenseNumber = `D${c + 1}${d + 1}${1000000 + c * 1000 + d}`;
    await pool.query(
      'UPDATE users SET phone = COALESCE(phone, $1), address = COALESCE(address, $2), license_number = COALESCE(license_number, $3) WHERE id = $4',
      [phone, address, licenseNumber, row.id]
    );
    console.log(`backfilled driver ${row.email}: ${phone} / ${address} / ${licenseNumber}`);
  }

  const students = await pool.query("UPDATE students SET notes = 'None' WHERE notes IS NULL RETURNING id, full_name");
  for (const row of students.rows) console.log(`backfilled student notes: ${row.full_name}`);

  // Parent phone/address (2026-09-01, § auto-match task) — same idea as the driver backfill
  // above: reuse the FIRST linked student's own phone/address, so the seeded parent is a
  // genuine match for that student under the real matching logic
  // (client/src/lib/parentMatch.ts), not a blank record that happens to be linked.
  const parents = await pool.query(`
    SELECT u.id, u.email,
      (SELECT s.parent_phone FROM parent_students ps JOIN students s ON s.id = ps.student_id
       WHERE ps.parent_user_id = u.id ORDER BY ps.created_at LIMIT 1) AS derived_phone,
      (SELECT s.street_address || ', ' || s.city || ', ' || s.state || ' ' || s.zip_code
       FROM parent_students ps JOIN students s ON s.id = ps.student_id
       WHERE ps.parent_user_id = u.id ORDER BY ps.created_at LIMIT 1) AS derived_address
    FROM users u
    WHERE u.role = 'parent' AND u.email ~ '^parent[0-9]+@company[0-9]+\\.com$' AND (u.phone IS NULL OR u.address IS NULL)
  `);
  for (const row of parents.rows) {
    if (!row.derived_phone && !row.derived_address) continue; // no linked student to derive from
    await pool.query('UPDATE users SET phone = COALESCE(phone, $1), address = COALESCE(address, $2) WHERE id = $3', [
      row.derived_phone,
      row.derived_address,
      row.id,
    ]);
    console.log(`backfilled parent ${row.email}: ${row.derived_phone} / ${row.derived_address}`);
  }

  console.log(`\nDone. ${drivers.rows.length} driver(s), ${students.rows.length} student(s), ${parents.rows.length} parent(s) backfilled.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
