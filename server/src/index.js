// Dev server entrypoint.
const createApp = require('./app');
const { port, sweepIntervalMs } = require('./config');
const { autoCompleteStaleTrips } = require('./services/trips');

const app = createApp();
app.listen(port, () => {
  console.log(`SafeRoute API listening on http://localhost:${port}`);
});

// In-process sweep for the trip 5-minute auto-complete (idempotent; safe across instances).
// The sweep lives here (not in createApp) so tests import the app without a background loop
// and call autoCompleteStaleTrips() directly.
const sweep = setInterval(() => {
  autoCompleteStaleTrips().catch((err) => console.error('[trip-sweep]', err));
}, sweepIntervalMs);
sweep.unref(); // don't keep the process alive just for the sweep
