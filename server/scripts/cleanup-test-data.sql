-- Remove test data from the production database (2026-09-24).
-- RUN on production 2026-09-24 (--commit). Deleted: trips 6, schedule_changes 0, assignments 14,
-- sessions 7, students 15, vans 7, users 27, companies 8, schools 8. Survey afterwards: 0 left.
-- Test data = companies / schools named "MVP Test …" or "Mobile Test …" (tags muekdz3c,
-- muelscel, mue67ebv, f5r4u), everything inside them, and every @example.test account.
-- One transaction: it either all goes, or nothing does. Children first, because trips,
-- schedule changes, sessions and assignments block deleting the rows they point at.

BEGIN;

CREATE TEMP TABLE test_companies ON COMMIT DROP AS
  SELECT id FROM companies
   WHERE name ILIKE ANY (ARRAY['%MVP Test%', '%Mobile Test%', '%muekdz3c%', '%muelscel%']);

CREATE TEMP TABLE test_schools ON COMMIT DROP AS
  SELECT id FROM schools
   WHERE name ILIKE ANY (ARRAY['%MVP Test%', '%Mobile Test%', '%muekdz3c%', '%muelscel%']);

-- Safety check: stop if a REAL company has a student at a test school, a test company has a
-- student at a real school, or an @example.test account belongs to a real company or school.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM students
     WHERE (school_id IN (SELECT id FROM test_schools)) <> (company_id IN (SELECT id FROM test_companies))
  ) OR EXISTS (
    SELECT 1 FROM users
     WHERE email ILIKE '%@example.test'
       AND NOT COALESCE(company_id IN (SELECT id FROM test_companies) OR school_id IN (SELECT id FROM test_schools), false)
  ) THEN
    RAISE EXCEPTION 'test data is mixed with real data: nothing deleted';
  END IF;
END $$;

DELETE FROM trips
 WHERE company_id IN (SELECT id FROM test_companies) OR school_id IN (SELECT id FROM test_schools);
DELETE FROM schedule_changes
 WHERE company_id IN (SELECT id FROM test_companies) OR school_id IN (SELECT id FROM test_schools);
DELETE FROM assignments WHERE company_id IN (SELECT id FROM test_companies);   -- + overrides (cascade)
DELETE FROM sessions    WHERE company_id IN (SELECT id FROM test_companies);
DELETE FROM students                                                            -- + contacts, parent links,
 WHERE company_id IN (SELECT id FROM test_companies)                            --   skips, no-shows, staff access,
    OR school_id  IN (SELECT id FROM test_schools);                             --   extra addresses (cascade)
DELETE FROM vans        WHERE company_id IN (SELECT id FROM test_companies);
DELETE FROM users                                                               -- + tokens, pay rules, adjustments,
 WHERE company_id IN (SELECT id FROM test_companies)                            --   monitor assignments (cascade)
    OR school_id  IN (SELECT id FROM test_schools)
    OR email ILIKE '%@example.test';
DELETE FROM companies WHERE id IN (SELECT id FROM test_companies);
DELETE FROM schools   WHERE id IN (SELECT id FROM test_schools);

COMMIT;
