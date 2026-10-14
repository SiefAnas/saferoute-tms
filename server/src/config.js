// Central config — all secrets/connection come from env only (spec §4).
require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';

// In production, refuse to boot on the insecure JWT_SECRET fallback or a missing
// DATABASE_URL rather than silently starting with defaults that would leak real data.
if (nodeEnv === 'production') {
  const missing = ['JWT_SECRET', 'DATABASE_URL'].filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `Refusing to start in production: missing required env var(s): ${missing.join(', ')}.`
    );
  }
}

module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  port: Number(process.env.PORT) || 4000,
  nodeEnv,
  // Trips: minutes after the first confirmation before a half-confirmed trip auto-completes,
  // and how often the in-process sweep runs.
  autoCompleteMinutes: Number(process.env.AUTO_COMPLETE_MINUTES) || 5,
  sweepIntervalMs: Number(process.env.SWEEP_INTERVAL_MS) || 30000,
  // Comma-separated list of origins allowed to call the API cross-origin (production
  // frontend/backend split). Empty in dev/test, where requests are same-origin anyway.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // The website's address, for links in emails (password reset). APP_URL if set, else the first
  // allowed origin (the production frontend), else the local Vite dev server.
  appUrl: (process.env.APP_URL || (process.env.ALLOWED_ORIGINS || '').split(',')[0].trim() || 'http://localhost:5173').replace(/\/+$/, ''),
  // SafeTurns support inbox: data deletion requests are emailed here (services/deletionRequests.js).
  // Unset = not emailed, and every such request logs that loudly.
  supportEmail: (process.env.SUPPORT_EMAIL || '').trim() || null,
  // Push notifications (services/push.js). Mobile goes through the Expo push service; the URLs
  // are only overridden by tests. EXPO_ACCESS_TOKEN is needed only if "enhanced push security"
  // is turned on for the Expo project.
  expoPushUrl: process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send',
  expoReceiptsUrl: process.env.EXPO_RECEIPTS_URL || 'https://exp.host/--/api/v2/push/getReceipts',
  expoAccessToken: (process.env.EXPO_ACCESS_TOKEN || '').trim() || null,
  // Browser Web Push (VAPID). Both keys unset = web push off (the website still shows the bell
  // and the list). Make a pair once with: npx web-push generate-vapid-keys
  vapidPublicKey: (process.env.VAPID_PUBLIC_KEY || '').trim() || null,
  vapidPrivateKey: (process.env.VAPID_PRIVATE_KEY || '').trim() || null,
  vapidSubject: (process.env.VAPID_SUBJECT || '').trim() || `mailto:${(process.env.SUPPORT_EMAIL || 'support@safeturns.com').trim()}`,
  // How often the in-process sweep sends notifications that have come due (scheduled sends).
  notificationSweepMs: Number(process.env.NOTIFICATION_SWEEP_MS) || 30000,
  // Monitor "Running late": minutes until the company admins are told the monitor still isn't
  // picked up (services/monitorStops.js).
  monitorLateEscalateMinutes: Number(process.env.MONITOR_LATE_ESCALATE_MINUTES) || 4,
  // How often the van maintenance / odometer reminder check runs (services/fleet.js).
  fleetSweepMs: Number(process.env.FLEET_SWEEP_MS) || 15 * 60 * 1000,
};
