// Sends every push notification that has come due, then checks Expo receipts, and exits.
// The API already does this every NOTIFICATION_SWEEP_MS while it runs (src/index.js). This script
// is for a cron job (e.g. a Render Cron Job every minute) so scheduled sends still go out on time
// when the API is asleep (Render free tier) or not running. Safe to run alongside the API: rows
// are claimed with FOR UPDATE SKIP LOCKED.
//
//   node scripts/send-due-notifications.js       (npm run notifications:send-due)
require('dotenv').config();
const pool = require('../src/db/pool');
const { sendDueNotifications, checkExpoReceipts } = require('../src/services/push');

(async () => {
  const sent = await sendDueNotifications();
  const checked = await checkExpoReceipts();
  console.log(`[push] sent ${sent} due notification(s), checked ${checked} receipt(s)`);
})()
  .catch((err) => { console.error('[push] FAILED', err); process.exitCode = 1; })
  .finally(() => pool.end());
