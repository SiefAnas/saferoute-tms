/* eslint-disable camelcase */
// Possible duplicate students: students.duplicate_name is true while another student of the
// SAME company at the same school has the same name (case, surrounding and repeated spaces
// ignored). Kept right by a trigger on every insert, rename, school change and delete, so every
// write path (form, CSV, bulk import, future ones) flags and unflags without app code. Scoped to
// one company on purpose: a flag must never reveal that another company has a student there.
// Never blocks anything. Existing duplicates are flagged by the backfill below.
exports.up = (pgm) => {
  pgm.addColumns('students', { duplicate_name: { type: 'boolean', notNull: true, default: false } });
  pgm.sql(`
    CREATE FUNCTION students_name_key(n text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE
      AS $$ SELECT regexp_replace(lower(btrim(n)), '\\s+', ' ', 'g') $$;

    CREATE INDEX students_company_school_name_key ON students (company_id, school_id, students_name_key(full_name));

    CREATE FUNCTION students_refresh_duplicate_name(c uuid, s uuid, n text) RETURNS void
      LANGUAGE sql
      AS $$
        UPDATE students st
           SET duplicate_name = dup.is_dup
          FROM (SELECT count(*) > 1 AS is_dup FROM students x
                 WHERE x.company_id = c AND x.school_id = s AND students_name_key(x.full_name) = students_name_key(n)) dup
         WHERE st.company_id = c AND st.school_id = s AND students_name_key(st.full_name) = students_name_key(n)
           AND st.duplicate_name IS DISTINCT FROM dup.is_dup
      $$;

    CREATE FUNCTION students_duplicate_name_trigger() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          PERFORM students_refresh_duplicate_name(OLD.company_id, OLD.school_id, OLD.full_name);
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          PERFORM students_refresh_duplicate_name(NEW.company_id, NEW.school_id, NEW.full_name);
        END IF;
        RETURN NULL;
      END
      $$;

    -- The row being written sets its own flag BEFORE the write, so the API's RETURNING * is right.
    CREATE FUNCTION students_duplicate_name_self() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        NEW.duplicate_name := EXISTS (
          SELECT 1 FROM students x
           WHERE x.id <> NEW.id AND x.company_id = NEW.company_id AND x.school_id = NEW.school_id
             AND students_name_key(x.full_name) = students_name_key(NEW.full_name));
        RETURN NEW;
      END
      $$;

    CREATE TRIGGER students_duplicate_name_self
      BEFORE INSERT OR UPDATE OF full_name, school_id, company_id ON students
      FOR EACH ROW EXECUTE FUNCTION students_duplicate_name_self();

    -- Then the other students in the old and new name groups. Column list: the refresh itself only
    -- sets duplicate_name, so it can't re-fire either trigger.
    CREATE TRIGGER students_duplicate_name
      AFTER INSERT OR DELETE OR UPDATE OF full_name, school_id, company_id ON students
      FOR EACH ROW EXECUTE FUNCTION students_duplicate_name_trigger();

    UPDATE students st SET duplicate_name = true
     WHERE EXISTS (SELECT 1 FROM students x
                    WHERE x.id <> st.id AND x.company_id = st.company_id AND x.school_id = st.school_id
                      AND students_name_key(x.full_name) = students_name_key(st.full_name));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS students_duplicate_name ON students;
    DROP TRIGGER IF EXISTS students_duplicate_name_self ON students;
    DROP FUNCTION IF EXISTS students_duplicate_name_trigger();
    DROP FUNCTION IF EXISTS students_duplicate_name_self();
    DROP FUNCTION IF EXISTS students_refresh_duplicate_name(uuid, uuid, text);
    DROP INDEX IF EXISTS students_company_school_name_key;
    DROP FUNCTION IF EXISTS students_name_key(text);
  `);
  pgm.dropColumns('students', ['duplicate_name']);
};
