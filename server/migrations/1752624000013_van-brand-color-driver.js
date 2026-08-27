/* eslint-disable camelcase */
// STEP — Fleet page task: split `model` into brand+model, add color, add an assigned driver
// per van. Only 2 real vans exist in the live dev DB at migration time (checked directly
// before writing this), both with `model` already populated ("Ford Transit SE", "Mercedes
// Sprinter") and `year` set — safe to backfill brand/model by re-parsing the existing text
// (deterministic, not invented data) and to make brand/model/year NOT NULL afterward.
//
// color and driver_user_id have no historical equivalent to backfill from, so — same
// precedent as migration 009's zip_code/state on companies/schools — they stay NULLABLE at
// the DB level (existing rows just show blank until edited) while the app layer requires
// them on every NEW van creation (server/src/routes/vans.js).

exports.up = (pgm) => {
  pgm.addColumns('vans', {
    brand: { type: 'text' },
    color: { type: 'text' },
    driver_user_id: { type: 'uuid' },
  });

  // Re-parse existing `model` ("Ford Transit SE") into brand ("Ford") + model ("Transit SE")
  // by splitting on the first space. A single-word model (no space) becomes its own brand
  // with model left as-is, rather than guessing.
  pgm.sql(`
    UPDATE vans
       SET brand = CASE WHEN position(' ' in model) > 0 THEN split_part(model, ' ', 1) ELSE model END,
           model = CASE WHEN position(' ' in model) > 0 THEN trim(substring(model from position(' ' in model) + 1)) ELSE model END
     WHERE model IS NOT NULL;
  `);
  // Defensive fallback only (no real row hits this today): a van with no model at all can't
  // be auto-split, so it gets a visible placeholder rather than silently failing the
  // NOT NULL constraint below.
  pgm.sql(`UPDATE vans SET brand = 'Unspecified', model = 'Unspecified' WHERE brand IS NULL OR model IS NULL;`);

  pgm.alterColumn('vans', 'brand', { notNull: true });
  pgm.alterColumn('vans', 'model', { notNull: true });
  pgm.alterColumn('vans', 'year', { notNull: true });

  pgm.addConstraint('vans', 'vans_driver_company_fk', {
    foreignKeys: {
      columns: ['driver_user_id', 'company_id'],
      references: 'users(id, company_id)',
      onDelete: 'RESTRICT',
    },
  });
  pgm.createIndex('vans', 'driver_user_id');
};

exports.down = (pgm) => {
  pgm.dropConstraint('vans', 'vans_driver_company_fk');
  // Best-effort reverse of the brand/model split — not guaranteed byte-identical to the
  // original single field, but close enough for a dev rollback.
  pgm.sql(`UPDATE vans SET model = brand || ' ' || model;`);
  pgm.alterColumn('vans', 'model', { notNull: false });
  pgm.alterColumn('vans', 'year', { notNull: false });
  pgm.dropColumn('vans', 'driver_user_id');
  pgm.dropColumn('vans', 'color');
  pgm.dropColumn('vans', 'brand');
};
