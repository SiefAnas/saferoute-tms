/* eslint-disable camelcase */
// STEP 1 — Vans (company-scoped) + Students (carry BOTH tenant keys). §4, §6.

const uuidPk = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
const withTimestamps = (pgm) => ({
  created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
});
const addUpdatedAtTrigger = (pgm, table) =>
  pgm.sql(
    `CREATE TRIGGER trg_${table}_updated_at BEFORE UPDATE ON "${table}" ` +
      'FOR EACH ROW EXECUTE FUNCTION set_updated_at();'
  );

exports.up = (pgm) => {
  // Vans — per company (§6).
  pgm.createTable('vans', {
    id: uuidPk(pgm),
    company_id: { type: 'uuid', notNull: true, references: 'companies(id)', onDelete: 'CASCADE' },
    license_plate: { type: 'text', notNull: true },
    model: { type: 'text' },
    year: { type: 'integer' },
    ...withTimestamps(pgm),
  });
  pgm.addConstraint('vans', 'vans_year_check', {
    check: 'year IS NULL OR (year BETWEEN 1900 AND 2100)',
  });
  pgm.createIndex('vans', 'company_id');
  pgm.sql('CREATE INDEX vans_license_plate_trgm_idx ON vans USING gin (license_plate gin_trgm_ops);');
  addUpdatedAtTrigger(pgm, 'vans');
  pgm.addConstraint('vans', 'vans_id_company_id_uniq', { unique: ['id', 'company_id'] });

  // Students — carry both company_id and school_id (§4, §6).
  // Guardian info is simple fields, NOT a separate table (decided this session, §6).
  pgm.createTable('students', {
    id: uuidPk(pgm),
    company_id: { type: 'uuid', notNull: true, references: 'companies(id)', onDelete: 'CASCADE' },
    school_id: { type: 'uuid', notNull: true, references: 'schools(id)', onDelete: 'CASCADE' },
    full_name: { type: 'text', notNull: true },
    grade: { type: 'text' }, // needed for School Admin search/filter (§7.3)
    parent_name: { type: 'text' },
    parent_phone: { type: 'text' },
    ...withTimestamps(pgm),
  });
  pgm.createIndex('students', 'company_id');
  pgm.createIndex('students', 'school_id');
  pgm.sql('CREATE INDEX students_full_name_trgm_idx ON students USING gin (full_name gin_trgm_ops);');
  addUpdatedAtTrigger(pgm, 'students');
  // Composite-unique targets for the tenant-consistency FKs in trips/assignments/staff access.
  pgm.addConstraint('students', 'students_id_company_id_uniq', { unique: ['id', 'company_id'] });
  pgm.addConstraint('students', 'students_id_school_id_uniq', { unique: ['id', 'school_id'] });
};

exports.down = (pgm) => {
  pgm.dropTable('students');
  pgm.dropTable('vans');
};
