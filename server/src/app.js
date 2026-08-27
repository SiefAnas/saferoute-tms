// Express app wiring. Exported as a factory so tests can mount it without listening.
const express = require('express');
const cors = require('cors');
const { allowedOrigins } = require('./config');
const authRoutes = require('./routes/auth');
const signupRoutes = require('./routes/signup');
const placeholderRoutes = require('./routes/placeholders');
const userRoutes = require('./routes/users');
const vanRoutes = require('./routes/vans');
const schoolRoutes = require('./routes/schools');
const studentRoutes = require('./routes/students');
const sessionRoutes = require('./routes/sessions');
const tripRoutes = require('./routes/trips');
const assignmentRoutes = require('./routes/assignments');
const payrollRoutes = require('./routes/payroll');
const staffAccessRoutes = require('./routes/staffAccess');
const scheduleRoutes = require('./routes/schedule');
const parentAccessRoutes = require('./routes/parentAccess');
const parentPortalRoutes = require('./routes/parentPortal');
const dashboardRoutes = require('./routes/dashboard');

function createApp() {
  const app = express();
  // NOT 1 hop, despite that being the commonly-cited default for "behind Render." A real
  // production request's raw X-Forwarded-For header was 3 entries deep:
  // "<real client>, <cloudflare edge>, <render internal hop>" — Render fronts every web
  // service with Cloudflare (confirmed separately: `Server: cloudflare` on every response
  // from this app) in addition to its own internal routing layer, so there are two
  // untrusted-but-legitimate hops before the request reaches this process, not one.
  // Verified directly against express's own req.ip resolution (not just reasoning about
  // it): trust=1 resolved to the Render-internal hop's private 10.x address (wrong);
  // trust=3 resolved to the real client IP (right) — see BACKLOG.md item #9 for the exact
  // values. `3`, not `true`: `true` trusts the entire chain unconditionally, which would
  // let a client spoof its own IP by sending its own X-Forwarded-For header with extra
  // fake entries prepended. If Render ever changes its internal hop count this may need
  // re-verifying the same way (temporarily exposing req.ip/xff and checking a live
  // request), not just bumping the number on faith.
  app.set('trust proxy', 3);
  // Dev (Vite proxy) and the embedded-Postgres test suite are same-origin/no-origin and
  // need no CORS headers at all; production splits frontend (static site) and backend
  // (web service) across origins, so ALLOWED_ORIGINS (comma-separated, set in Render env)
  // opts in specific origins rather than reflecting every Origin header.
  app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/auth', authRoutes);
  app.use('/signup', signupRoutes);
  app.use('/placeholders', placeholderRoutes);
  app.use('/users', userRoutes);
  app.use('/vans', vanRoutes);
  app.use('/schools', schoolRoutes);
  app.use('/students', studentRoutes);
  app.use('/sessions', sessionRoutes);
  app.use('/trips', tripRoutes);
  app.use('/assignments', assignmentRoutes);
  app.use('/payroll', payrollRoutes);
  app.use('/staff-access', staffAccessRoutes);
  app.use('/schedule', scheduleRoutes);
  app.use('/parent-access', parentAccessRoutes);
  app.use('/parent', parentPortalRoutes);
  app.use('/dashboard', dashboardRoutes);

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
