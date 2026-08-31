// Full dummy-data reset (2026-08-28). Run against DATABASE_URL from server/.env — this
// targets whatever the app itself points at (the live dev DB), not a throwaway instance.
// Companion to the DB wipe that preceded it (documented in BACKLOG.md); this script only
// re-seeds, it does not delete — the wipe was a one-off deliberate action, not something
// this script repeats.
//
// Shape (per the task):
//   3 companies x 2 drivers each (6 drivers), 3 schools x 6 staff each (18 staff),
//   18 students (6 per school), 25 parent accounts covering three required cases:
//     - one parent linked to 2 kids
//     - one parent linked to 2 kids at 2 different schools served by 2 different companies
//     - one student with 3 separate parent accounts
//
// ASSUMPTION, flagged for confirmation: the "2 kids / 2 different companies" case is not
// buildable — parent_students' own composite FKs require the parent and student to share
// one company_id, so a parent literally cannot link across companies. Anas confirmed
// relaxing this to "2 kids, 2 different schools, same company" instead (still exercises
// the multi-school case, just not multi-company) rather than a live schema change.
//
// Also ASSUMPTION: the task named company_admin/school_admin email patterns for
// drivers/staff/parents but not for the org admins themselves — extended the same
// convention (admin@company1.com / admin@school1.com) for consistency.
//
// All accounts share the same password already used throughout this project's dummy data
// (Secret123!) so it's a known, memorable login for testing.
require('dotenv').config();
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');

const PW = 'Secret123!';

async function main() {
  const hash = await hashPassword(PW);
  const q = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
  const qAll = (sql, params) => pool.query(sql, params).then((r) => r.rows);

  // ---- Companies + Schools ----
  const companyNames = ['Sunrise Transit Co.', 'Blue Ridge Transportation', 'Metro School Rides'];
  const companies = [];
  for (const name of companyNames) {
    companies.push(await q("INSERT INTO companies(name,claim_status,claimed_at) VALUES($1,'claimed',now()) RETURNING id", [name]));
  }

  const schoolNames = ['Maple Grove Elementary', 'Riverside Middle School', 'Oakwood High School'];
  const schools = [];
  for (const name of schoolNames) {
    schools.push(await q("INSERT INTO schools(name,claim_status,claimed_at) VALUES($1,'claimed',now()) RETURNING id", [name]));
  }

  async function createUser({ email, fullName, role, companyId, schoolId }) {
    return q(
      `INSERT INTO users(email,password_hash,full_name,role,company_id,school_id,email_verified_at,is_active)
       VALUES($1,$2,$3,$4,$5,$6,now(),true) RETURNING id`,
      [email, hash, fullName, role, companyId ?? null, schoolId ?? null]
    );
  }

  // ---- Company admins + drivers ----
  const companyAdminNames = ['Jordan Ellis', 'Priya Nandakumar', 'Marcus Webb'];
  const driverNames = [
    ['Emma Watson', 'Liam Novak'],
    ['Sofia Martinez', 'Derek Chan'],
    ['Aisha Bello', 'Tom Bennett'],
  ];
  const drivers = []; // drivers[companyIndex] = [{id}, {id}]
  for (let c = 0; c < 3; c++) {
    const domain = `company${c + 1}.com`;
    await createUser({ email: `admin@${domain}`, fullName: `${companyAdminNames[c]} (Company Admin)`, role: 'company_admin', companyId: companies[c].id });
    const pair = [];
    for (let d = 0; d < 2; d++) {
      const u = await createUser({
        email: `driver${d + 1}@${domain}`,
        fullName: `${driverNames[c][d]} (Driver ${d + 1})`,
        role: 'driver',
        companyId: companies[c].id,
      });
      pair.push(u.id);
    }
    drivers.push(pair);
  }

  // ---- Vans (2 per company, one per driver) ----
  const vans = []; // vans[companyIndex] = [id, id]
  const vanSpecs = [
    ['Ford', 'Transit', 2022, 'White'],
    ['Mercedes', 'Sprinter', 2023, 'Silver'],
  ];
  for (let c = 0; c < 3; c++) {
    const pair = [];
    for (let v = 0; v < 2; v++) {
      const plate = `VAN-${(c + 1) * 100 + v + 1}`;
      const [brand, model, year, color] = vanSpecs[v];
      const row = await q(
        'INSERT INTO vans(company_id,license_plate,brand,model,year,color) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
        [companies[c].id, plate, brand, model, year, color]
      );
      pair.push(row.id);
    }
    vans.push(pair);
  }

  // ---- School admins + staff ----
  const schoolAdminNames = ['Grace Kim', 'Victor Alonso', 'Nadia Farouk'];
  const staffNames = [
    ['Olivia Brooks', 'Ethan Ramirez', 'Zoe Patel', 'Noah Kessler', 'Maya Lindqvist', 'Caleb Osei'],
    ['Ruby Chen', 'Hassan Ali', 'Ivy Thompson', 'Leo Fischer', 'Aria Delgado', "Finn O'Brien"],
    ['Lena Kowalski', 'Milo Andersson', 'Nora Haddad', 'Owen Whitfield', 'Piper Nakamura', 'Rhys Donnelly'],
  ];
  for (let s = 0; s < 3; s++) {
    const domain = `school${s + 1}.com`;
    await createUser({ email: `admin@${domain}`, fullName: `${schoolAdminNames[s]} (School Admin)`, role: 'school_admin', schoolId: schools[s].id });
    for (let i = 0; i < 6; i++) {
      await createUser({
        email: `staff${i + 1}@${domain}`,
        fullName: `${staffNames[s][i]} (Staff ${i + 1})`,
        role: 'school_staff',
        schoolId: schools[s].id,
      });
    }
  }

  // ---- Students (6 per school) + which company/driver/van serves each ----
  // schoolIdx, name, grade, age, companyIdx, driverIdx-in-company, vanIdx-in-company
  const studentSpecs = [
    // School 1 (Maple Grove) -- served by Co1 (first 3) and Co2 (last 3)
    [0, 'Ava Sullivan', '2', 7, 0, 0, 0],
    [0, 'Mason Reilly', '3', 8, 0, 1, 1],
    [0, 'Chloe Bennett', '1', 6, 0, 0, 0],
    [0, 'Jackson Diaz', '4', 9, 1, 0, 0],
    [0, 'Harper Nguyen', '2', 7, 1, 1, 1],
    [0, 'Elijah Kowalczyk', '5', 10, 1, 0, 0],
    // School 2 (Riverside) -- served by Co2 (first 3) and Co3 (last 3)
    [1, 'Lily Park', '6', 11, 1, 1, 1],
    [1, 'Wyatt Park', '4', 9, 1, 0, 0],
    [1, 'Grace Thornton', '6', 11, 1, 1, 1],
    [1, 'Benjamin Osei', '5', 10, 2, 0, 0],
    [1, 'Aria Mendez', '7', 12, 2, 1, 1],
    [1, 'Julian Ferreira', '6', 11, 2, 0, 0],
    // School 3 (Oakwood) -- served by Co3 (first 3) and Co1 (last 3)
    [2, 'Isabella Cruz', '8', 13, 2, 1, 1],
    [2, 'Mateo Ibrahim', '7', 12, 2, 0, 0],
    [2, 'Sophie Lindgren', '8', 13, 2, 1, 1],
    [2, 'Ryan Sullivan', '6', 11, 0, 1, 1],
    [2, 'Nathaniel Brooks', '5', 10, 0, 0, 0],
    [2, 'Willow Foster', '7', 12, 0, 1, 1],
  ];
  const streetPool = ['12 Maple St', '48 Oak Ave', '7 Birch Ln', '203 Cedar Rd', '19 Pine Ct', '5 Elm Dr'];
  const students = {}; // keyed by name -> {id, companyId}
  let asgCount = 0;
  for (const [schoolIdx, name, grade, age, companyIdx, driverIdx, vanIdx] of studentSpecs) {
    const companyId = companies[companyIdx].id;
    const schoolId = schools[schoolIdx].id;
    const student = await q(
      `INSERT INTO students(company_id,school_id,full_name,grade,age,parent_name,parent_phone,street_address,city,state,zip_code)
       VALUES($1,$2,$3,$4,$5,'TBD','555-0000',$6,'Springfield','CA','90210') RETURNING id`,
      [companyId, schoolId, name, grade, age, streetPool[asgCount % streetPool.length]]
    );
    students[name] = { id: student.id, companyId, driverId: drivers[companyIdx][driverIdx], vanId: vans[companyIdx][vanIdx] };
    await pool.query(
      `INSERT INTO assignments(company_id,student_id,driver_user_id,van_id,start_date,pickup_time,dropoff_time)
       VALUES($1,$2,$3,$4,CURRENT_DATE,'08:00','15:15')`,
      [companyId, student.id, drivers[companyIdx][driverIdx], vans[companyIdx][vanIdx]]
    );
    asgCount++;
  }

  // ---- Parent accounts + links ----
  // Each entry: [companyIdx, firstName, lastName, [studentNames...]]
  const parentSpecs = [
    // Company 1 (7 parents) -- includes the cross-school-same-company case (Sullivan siblings)
    [0, 'David', 'Sullivan', ['Ava Sullivan', 'Ryan Sullivan']], // Case: 2 kids, 2 schools, same company
    [0, 'Karen', 'Reilly', ['Mason Reilly']],
    [0, 'Frank', 'Reilly', ['Mason Reilly']],
    [0, 'Diane', 'Bennett', ['Chloe Bennett']],
    [0, 'George', 'Brooks', ['Nathaniel Brooks']],
    [0, 'Helen', 'Brooks', ['Nathaniel Brooks']],
    [0, 'Monica', 'Foster', ['Willow Foster']],
    // Company 2 (7 parents) -- includes the simple 2-kids-same-school case (Park siblings)
    [1, 'Rachel', 'Diaz', ['Jackson Diaz']],
    [1, 'Steven', 'Diaz', ['Jackson Diaz']],
    [1, 'Linda', 'Nguyen', ['Harper Nguyen']],
    [1, 'Tom', 'Kowalczyk', ['Elijah Kowalczyk']],
    [1, 'Susan', 'Park', ['Lily Park', 'Wyatt Park']], // Case: 2 kids, same school, same company
    [1, 'Carlos', 'Thornton', ['Grace Thornton']],
    [1, 'Angela', 'Thornton', ['Grace Thornton']],
    // Company 3 (11 parents) -- includes the 3-guardians-one-student case (Benjamin Osei)
    [2, 'Angela', 'Osei', ['Benjamin Osei']], // Case: 1 student, 3 parent accounts (1/3)
    [2, 'Kevin', 'Osei', ['Benjamin Osei']], // (2/3)
    [2, 'Priscilla', 'Adeyemi', ['Benjamin Osei']], // (3/3) -- different surname, e.g. a guardian
    [2, 'Maria', 'Mendez', ['Aria Mendez']],
    [2, 'Julio', 'Mendez', ['Aria Mendez']],
    [2, 'Paulo', 'Ferreira', ['Julian Ferreira']],
    [2, 'Elena', 'Cruz', ['Isabella Cruz']],
    [2, 'Ahmed', 'Ibrahim', ['Mateo Ibrahim']],
    [2, 'Farah', 'Ibrahim', ['Mateo Ibrahim']],
    [2, 'Erik', 'Lindgren', ['Sophie Lindgren']],
    [2, 'Astrid', 'Lindgren', ['Sophie Lindgren']],
  ];
  const perCompanyCounter = [0, 0, 0];
  const creatorAdminId = {}; // companyIdx -> that company's admin user id, for created_by_user_id
  for (let c = 0; c < 3; c++) {
    const row = await q('SELECT id FROM users WHERE company_id=$1 AND role=$2', [companies[c].id, 'company_admin']);
    creatorAdminId[c] = row.id;
  }

  for (const [companyIdx, first, last, studentNames] of parentSpecs) {
    perCompanyCounter[companyIdx]++;
    const n = perCompanyCounter[companyIdx];
    const email = `parent${n}@company${companyIdx + 1}.com`;
    const parent = await q(
      `INSERT INTO users(email,password_hash,full_name,role,company_id,email_verified_at,is_active,created_by_user_id)
       VALUES($1,$2,$3,'parent',$4,now(),true,$5) RETURNING id`,
      [email, hash, `${first} ${last} (Parent)`, companies[companyIdx].id, creatorAdminId[companyIdx]]
    );
    for (const studentName of studentNames) {
      const s = students[studentName];
      await pool.query(
        'INSERT INTO parent_students(parent_user_id,student_id,company_id,created_by_user_id) VALUES($1,$2,$3,$4)',
        [parent.id, s.id, s.companyId, creatorAdminId[companyIdx]]
      );
      // Stamp the student's own primary-contact text fields (students.parent_name/phone)
      // from the FIRST parent linked, so the row isn't left with the placeholder 'TBD'.
      await pool.query(
        `UPDATE students SET parent_name=$1, parent_phone=$2 WHERE id=$3 AND parent_name='TBD'`,
        [`${first} ${last}`, `555-0${100 + n}`, s.id]
      );
    }
  }

  console.log('Seed complete.');
  console.log(`Companies: ${companies.length}, Schools: ${schools.length}, Students: ${Object.keys(students).length}`);
  console.log(`Parents created: ${parentSpecs.length}`);
  await pool.end();
}

main().catch((e) => {
  console.error('SEED FAILED:', e);
  process.exit(1);
});
