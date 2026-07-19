// Express app wiring. Exported as a factory so tests can mount it without listening.
const express = require('express');
const cors = require('cors');
const { allowedOrigins } = require('./config');
const authRoutes = require('./routes/auth');
const signupRoutes = require('./routes/signup');
const placeholderRoutes = require('./routes/placeholders');
const userRoutes = require('./routes/users');
const vanRoutes = require('./routes/vans');
const studentRoutes = require('./routes/students');
const sessionRoutes = require('./routes/sessions');
const tripRoutes = require('./routes/trips');
const assignmentRoutes = require('./routes/assignments');
const payrollRoutes = require('./routes/payroll');
const staffAccessRoutes = require('./routes/staffAccess');

function createApp() {
  const app = express();
  // Render puts exactly one reverse proxy hop in front of a web service (per Render's own
  // docs/community guidance; cross-checked live against a real production request's raw
  // X-Forwarded-For header — see BACKLOG.md). `1` tells Express to trust that one hop's
  // X-Forwarded-For entry for req.ip/req.ips — NOT `true`, which would trust the whole
  // chain and let a client spoof its own IP by sending its own X-Forwarded-For header.
  // Without this, express-rate-limit logged ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every
  // request and fell back to keying limits off Express's default (unreliable behind any
  // proxy) IP resolution.
  app.set('trust proxy', 1);
  // Dev (Vite proxy) and the embedded-Postgres test suite are same-origin/no-origin and
  // need no CORS headers at all; production splits frontend (static site) and backend
  // (web service) across origins, so ALLOWED_ORIGINS (comma-separated, set in Render env)
  // opts in specific origins rather than reflecting every Origin header.
  app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
  app.use(express.json());

  // TEMPORARY — verifying the trust-proxy hop count against real Render traffic before
  // relying on it; remove this block once confirmed (see BACKLOG.md item #9).
  app.use((req, res, next) => {
    console.log(`[trust-proxy-check] xff=${req.headers['x-forwarded-for']} req.ip=${req.ip} req.ips=${JSON.stringify(req.ips)}`);
    next();
  });

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/auth', authRoutes);
  app.use('/signup', signupRoutes);
  app.use('/placeholders', placeholderRoutes);
  app.use('/users', userRoutes);
  app.use('/vans', vanRoutes);
  app.use('/students', studentRoutes);
  app.use('/sessions', sessionRoutes);
  app.use('/trips', tripRoutes);
  app.use('/assignments', assignmentRoutes);
  app.use('/payroll', payrollRoutes);
  app.use('/staff-access', staffAccessRoutes);

  app.use((req, res) => res.status(404).json({ error: 'not found' }));

  // Central error handler: any error carrying a numeric .status (ScopeError=403,
  // HttpError from services, etc.) maps to that; everything else is a 500.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && Number.isInteger(err.status)) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

module.exports = createApp;
