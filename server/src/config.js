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
};
