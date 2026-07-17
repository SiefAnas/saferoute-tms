// Express app wiring. Exported as a factory so tests can mount it without listening.
const express = require('express');
const authRoutes = require('./routes/auth');
const { ScopeError } = require('./db/scoped');

function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/auth', authRoutes);

  app.use((req, res) => res.status(404).json({ error: 'not found' }));

  // Central error handler: ScopeError -> 403, everything else -> 500.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ScopeError) return res.status(err.status || 403).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

module.exports = createApp;
