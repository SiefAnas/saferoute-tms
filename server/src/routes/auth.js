// Shared login for all 4 roles (§5.1). JWT issued on success.
const express = require('express');
const pool = require('../db/pool');
const { verifyPassword, DUMMY_HASH } = require('../auth/password');
const authenticate = require('../middleware/authenticate');
const { verifyEmail, resendVerification } = require('../services/signup');
const { loginLimiter, verifyLimiter, passwordResetLimiter } = require('../middleware/rateLimit');
const { changePassword, requestPasswordReset, resetPassword, loginPayload } = require('../services/passwords');

const router = express.Router();

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    const user = rows[0];

    // Always run a compare (dummy hash when user is missing) for uniform timing.
    const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !user.is_active || !ok) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    // user.must_change_password: the client must send the user to "set your password" first
    // (every other endpoint answers 403 PASSWORD_CHANGE_REQUIRED until they do).
    res.json(loginPayload(user));
  } catch (err) {
    next(err);
  }
});

// Current identity (proves the token + is_active re-check). Allowed while a password change is
// pending, so the client can find out it has to ask for one.
router.get('/me', authenticate.allowPasswordChange, (req, res) => res.json({ user: req.auth }));

// Change own password (also the forced first-login change). Returns a new token + user.
router.post('/change-password', authenticate.allowPasswordChange, async (req, res, next) => {
  try {
    res.json(await changePassword(req, req.body || {}));
  } catch (err) {
    next(err);
  }
});

// Forgot password: always { ok: true }, whether or not the email has an account.
router.post('/forgot-password', passwordResetLimiter, async (req, res, next) => {
  try {
    res.json(await requestPasswordReset((req.body || {}).email));
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', passwordResetLimiter, async (req, res, next) => {
  try {
    res.json(await resetPassword(req.body || {}));
  } catch (err) {
    next(err);
  }
});

// Finalize a claim by verifying the claimant's email (§5.3).
router.post('/verify-email', verifyLimiter, async (req, res, next) => {
  try {
    res.json(await verifyEmail((req.body || {}).token));
  } catch (err) {
    next(err);
  }
});

router.post('/resend-verification', verifyLimiter, async (req, res, next) => {
  try {
    res.json(await resendVerification((req.body || {}).email));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
