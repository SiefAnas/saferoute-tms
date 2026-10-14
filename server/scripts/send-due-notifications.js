// The Render Cron Job (docs/render-cron-job.md): one pass of everything time-based, then exit.
//   1. driver sign-in reminders that are due now (services/signinReminders.js)
//   2. scheduled notifications that have come due, and retries (services/push.js)
//   3. Expo receipts (removes devices that uninstalled the app)
//   4. van maintenance and odometer reminders (services/fleet.js; 07:00-20:00 company time)
// The API does all of this itself while it is awake (src/index.js). This script is what still
// makes it happen when the API is asleep (Render free tier) or down, e.g. a 6:30 am sign-in
// reminder. Safe to run alongside the API and to overlap itself: every send is claimed in the
// database first (FOR UPDATE SKIP LOCKED / ON CONFLICT DO NOTHING / conditional UPDATE).
//
//   npm run notifications:send-due      (checks DATABASE_URL first: needs ALLOW_PRODUCTION_DB=yes)
require('dotenv').config();
const pool = require('../src/db/pool');
const { sendDueNotifications, checkExpoReceipts } = require('../src/services/push');
const { runFleetReminders } = require('../src/services/fleet');
const { runSigninReminders } = require('../src/services/signinReminders');

(async () => {
  const signin = await runSigninReminders();
  const sent = await sendDueNotifications();
  const checked = await checkExpoReceipts();
  const fleet = await runFleetReminders();
  console.log(
    `[cron] ${new Date().toISOString()} sign-in reminders ${signin}, due notifications ${sent}, receipts checked ${checked}, fleet reminders ${fleet}`
  );
})()
  .catch((err) => { console.error('[cron] FAILED', err); process.exitCode = 1; })
  .finally(() => pool.end());
