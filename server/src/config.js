// Central config — all secrets/connection come from env only (spec §4).
require('dotenv').config();

module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  // Trips: minutes after the first confirmation before a half-confirmed trip auto-completes,
  // and how often the in-process sweep runs.
  autoCompleteMinutes: Number(process.env.AUTO_COMPLETE_MINUTES) || 5,
  sweepIntervalMs: Number(process.env.SWEEP_INTERVAL_MS) || 30000,
};
