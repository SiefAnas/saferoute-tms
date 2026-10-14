/* eslint-disable camelcase */
// Monitor home address (branch monitor-address-and-crew). Same four columns students use
// (1752624000014), so the apps format and copy it the same way. The driver picks the monitor up
// there before the first student stop, so it is shown on the driver's run.
// Nullable: existing monitors have no address yet. The API only accepts these columns for
// monitors (services/users.js, services/account.js); other roles keep the free-text `address`.
exports.up = (pgm) => {
  pgm.addColumns('users', {
    street_address: { type: 'text' },
    city: { type: 'text' },
    state: { type: 'text' },
    zip_code: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('users', ['street_address', 'city', 'state', 'zip_code']);
};
