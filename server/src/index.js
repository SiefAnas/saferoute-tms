// Dev server entrypoint.
// First, before anything opens a connection: a non-local DATABASE_URL needs ALLOW_PRODUCTION_DB=yes
// (src/db/productionGuard.js). Render sets it; a laptop with production in server/.env doesn't.
require('./db/productionGuard').assertTargetAllowed({ purpose: 'start the API' });

const createApp = require('./app');
const { port, sweepIntervalMs } = require('./config');
const { autoCompleteStaleTrips } = require('./services/trips');

const app = createApp();
app.listen(port, () => {
  console.log(`SafeTurns API listening on http://localhost:${port}`);
});

// In-process sweep for the trip 5-minute auto-complete (idempotent; safe across instances).
// The sweep lives here (not in createApp) so tests import the app without a background loop
// and call autoCompleteStaleTrips() directly.
const sweep = setInterval(() => {
  autoCompleteStaleTrips().catch((err) => console.error('[trip-sweep]', err));
}, sweepIntervalMs);
sweep.unref(); // don't keep the process alive just for the sweep
