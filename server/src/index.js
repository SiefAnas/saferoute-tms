// Dev server entrypoint.
const createApp = require('./app');
const { port, sweepIntervalMs } = require('./config');
const { autoCompleteStaleTrips } = require('./services/trips');
const { loadLegalDocuments, LEGAL_DIR } = require('./services/legal');

// The Terms / Privacy files ship with this code (src/legal). Without them signup can't check
// what people agreed to, so a missing or broken file stops the server instead of limping on.
try {
  const docs = loadLegalDocuments();
  console.log(`[legal] terms ${docs.terms.version}, privacy ${docs.privacy.version}`);
} catch (err) {
  console.error(`[legal] FATAL: cannot load the Terms / Privacy documents from ${LEGAL_DIR}: ${err.message}`);
  console.error('[legal] Refusing to start. Restore server/src/legal/terms.md and privacy.md (or set LEGAL_DIR).');
  process.exit(1);
}

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
