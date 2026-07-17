// Express app wiring. Exported as a factory so tests can mount it without listening.
const express = require('express');
const authRoutes = require('./routes/auth');
const signupRoutes = require('./routes/signup');
const placeholderRoutes = require('./routes/placeholders');
const userRoutes = require('./routes/users');
const vanRoutes = require('./routes/vans');
const studentRoutes = require('./routes/students');
const sessionRoutes = require('./routes/sessions');
const assignmentRoutes = require('./routes/assignments');
const payrollRoutes = require('./routes/payroll');

function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/auth', authRoutes);
  app.use('/signup', signupRoutes);
  app.use('/placeholders', placeholderRoutes);
  app.use('/users', userRoutes);
  app.use('/vans', vanRoutes);
  app.use('/students', studentRoutes);
  app.use('/sessions', sessionRoutes);
  app.use('/assignments', assignmentRoutes);
  app.use('/payroll', payrollRoutes);

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
