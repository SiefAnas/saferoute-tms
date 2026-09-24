// Read-only survey of test data in the database DATABASE_URL points at (server/.env).
// Counts what the cleanup (scripts/cleanup-test-data.sql) would remove. Changes nothing.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const TEST = `(name ILIKE '%MVP Test%' OR name ILIKE '%Mobile Test%' OR name ILIKE '%muekdz3c%' OR name ILIKE '%muelscel%')`;
const TEST_USER = `(email ILIKE '%@example.test' OR full_name ILIKE '%MVP Test%' OR full_name ILIKE '%Mobile Test%' OR email ILIKE '%muekdz3c%' OR email ILIKE '%muelscel%')`;

async function main() {
  const q = async (label, sql) => {
    const { rows } = await pool.query(sql);
    console.log(`\n== ${label}: ${rows.length}`);
    for (const r of rows.slice(0, 40)) console.log('  ', JSON.stringify(r));
  };
  await q('test companies', `SELECT id, name, claim_status FROM companies WHERE ${TEST} ORDER BY name`);
  await q('test schools', `SELECT id, name, claim_status FROM schools WHERE ${TEST} ORDER BY name`);
  await q('test users (email/name)', `SELECT u.role, u.email, u.full_name, c.name AS company, s.name AS school
      FROM users u LEFT JOIN companies c ON c.id = u.company_id LEFT JOIN schools s ON s.id = u.school_id
     WHERE ${TEST_USER.replace(/email/g, 'u.email').replace(/full_name/g, 'u.full_name')} ORDER BY u.email`);
  await q('test students (by name, or in a test company/school)', `SELECT st.full_name, c.name AS company, sc.name AS school
      FROM students st JOIN companies c ON c.id = st.company_id JOIN schools sc ON sc.id = st.school_id
     WHERE st.full_name ILIKE ANY (ARRAY['%MVP Test%','%Mobile Test%','%muekdz3c%','%muelscel%'])
        OR c.name ILIKE ANY (ARRAY['%MVP Test%','%Mobile Test%','%muekdz3c%','%muelscel%'])
        OR sc.name ILIKE ANY (ARRAY['%MVP Test%','%Mobile Test%','%muekdz3c%','%muelscel%'])`);
  await q('test vans (plate tag, or in a test company)', `SELECT v.license_plate, c.name AS company FROM vans v JOIN companies c ON c.id = v.company_id
     WHERE v.license_plate ILIKE '%muekdz3c%' OR v.license_plate ILIKE '%muelscel%' OR v.license_plate ILIKE 'MVP%' OR c.name ILIKE '%MVP Test%' OR c.name ILIKE '%Mobile Test%'`);
  await q('test users sitting in a REAL company or school (need care)', `SELECT u.role, u.email, c.name AS company, s.name AS school
      FROM users u LEFT JOIN companies c ON c.id = u.company_id LEFT JOIN schools s ON s.id = u.school_id
     WHERE (u.email ILIKE '%@example.test' OR u.email ILIKE '%muekdz3c%' OR u.email ILIKE '%muelscel%')
       AND NOT (COALESCE(c.name, '') ILIKE ANY (ARRAY['%MVP Test%','%Mobile Test%','%muekdz3c%','%muelscel%'])
             OR COALESCE(s.name, '') ILIKE ANY (ARRAY['%MVP Test%','%Mobile Test%','%muekdz3c%','%muelscel%']))`);
  await q('foreign keys pointing at companies / schools / users / students (delete rule)', `
    SELECT conrelid::regclass AS child, confrelid::regclass AS parent, confdeltype AS on_delete
      FROM pg_constraint WHERE contype = 'f' AND confrelid::regclass::text IN ('companies','schools','users','students','vans','sessions','assignments')
     ORDER BY parent, child`);
  await pool.end();
}
main().catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
