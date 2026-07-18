// Rate limiting for unauthenticated / abuse-prone endpoints (BACKLOG: searchClaimable was
// flagged as unauthenticated + unthrottled — a general MVP gap, not just there).
//
// Disabled during automated tests (NODE_ENV=test): the existing suites legitimately fire
// many requests at these routes in quick succession (e.g. logging in as several seeded
// users per suite), and a real limit would make them flaky, not the endpoints under test.
// Set RATE_LIMIT_FORCE=1 to exercise the real limiter in a dedicated test.
const rateLimit = require('express-rate-limit');

const DISABLED = process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_FORCE !== '1';

function createLimiter({ windowMs, max, message }) {
  if (DISABLED) return (req, res, next) => next();
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
}

// Auth: guard against credential-stuffing / brute force.
const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_LOGIN_MAX) || 20,
  message: 'too many login attempts, please try again later',
});

// Signup/claim: guard against mass placeholder/org creation.
const signupLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_SIGNUP_MAX) || 20,
  message: 'too many signup attempts, please try again later',
});

// Claimable search: unauthenticated, explicitly flagged as an enumeration/DoS surface.
const searchLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_SEARCH_MAX) || 60,
  message: 'too many search requests, please slow down',
});

// Email-sending endpoints: each hit sends real mail (or would, with a real transport).
const verifyLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_VERIFY_MAX) || 20,
  message: 'too many attempts, please try again later',
});

module.exports = { loginLimiter, signupLimiter, searchLimiter, verifyLimiter };
