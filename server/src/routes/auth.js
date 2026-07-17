// Shared login for all 4 roles (§5.1). JWT issued on success.
const express = require('express');
const pool = require('../db/pool');
const { verifyPassword, DUMMY_HASH } = require('../auth/password');
const { signJwt } = require('../auth/jwt');
const { tenantTypeForRole } = require('../db/scoped');
const authenticate = require('../middleware/authenticate');
const { verifyEmail, resendVerification } = require('../services/signup');

const router = express.Router();

router.post('/login', async (req, res, next) => {
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

    const tenantType = tenantTypeForRole(user.role);
    const tenantId = tenantType === 'company' ? user.company_id : user.school_id;
    const token = signJwt({ sub: user.id, role: user.role, tt: tenantType, tid: tenantId });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        tenantType,
        tenantId,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Current identity (proves the token + is_active re-check).
router.get('/me', authenticate, (req, res) => res.json({ user: req.auth }));

// Finalize a claim by verifying the claimant's email (§5.3).
router.post('/verify-email', async (req, res, next) => {
  try {
    res.json(await verifyEmail((req.body || {}).token));
  } catch (err) {
    next(err);
  }
});

router.post('/resend-verification', async (req, res, next) => {
  try {
    res.json(await resendVerification((req.body || {}).email));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
