// Dev server entrypoint.
const createApp = require('./app');
const { port } = require('./config');

const app = createApp();
app.listen(port, () => {
  console.log(`SafeRoute API listening on http://localhost:${port}`);
});
