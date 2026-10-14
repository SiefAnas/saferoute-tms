// Dev server entrypoint.
// First, before anything opens a connection: a non-local DATABASE_URL needs ALLOW_PRODUCTION_DB=yes
// (src/db/productionGuard.js). Render sets it; a laptop with production in server/.env doesn't.
require('./db/productionGuard').assertTargetAllowed({ purpose: 'start the API' });

const createApp = require('./app');
const { port, sweepIntervalMs, notificationSweepMs, fleetSweepMs, signinSweepMs } = require('./config');
const { autoCompleteStaleTrips } = require('./services/trips');
const { sendDueNotifications, checkExpoReceipts } = require('./services/push');
const { runFleetReminders } = require('./services/fleet');
const { runSigninReminders } = require('./services/signinReminders');
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

// Push notifications (services/push.js): send what has come due (scheduled sends and retries),
// then check Expo receipts so dead device tokens are removed. Claims rows with SKIP LOCKED, so
// it is safe with several instances, and with scripts/send-due-notifications.js run by a cron.
let pushSweepRunning = false;
const pushSweep = setInterval(() => {
  if (pushSweepRunning) return;
  pushSweepRunning = true;
  sendDueNotifications()
    .then(() => checkExpoReceipts())
    .catch((err) => console.error('[push-sweep]', err))
    .finally(() => { pushSweepRunning = false; });
}, notificationSweepMs);
pushSweep.unref();

// Van maintenance + odometer reminders (services/fleet.js): only sends 07:00-20:00 local, once per
// cycle, claimed in the database so several instances (or the cron script) never double-send.
const fleetSweep = setInterval(() => {
  runFleetReminders().catch((err) => console.error('[fleet-sweep]', err));
}, fleetSweepMs);
fleetSweep.unref();

// Driver sign-in reminders (services/signinReminders.js): every minute while the API is awake. The
// Render cron job (docs/render-cron-job.md) runs the same check when it is asleep; each reminder is
// claimed in the database, so the two never double up.
const signinSweep = setInterval(() => {
  runSigninReminders().catch((err) => console.error('[signin-sweep]', err));
}, signinSweepMs);
signinSweep.unref();
