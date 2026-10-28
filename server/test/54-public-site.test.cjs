// Public website forms (routes/publicSite.js): Contact us emails the admin or support inbox; Book a
// demo saves a row and emails the admin inbox. Plus the rate limit on both (RATE_LIMIT_FORCE=1).
const PG_PORT = 5535;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-54';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_FORCE = '1';
process.env.RATE_LIMIT_PUBLIC_FORM_MAX = '7';

const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const mailer = require('../src/mail/mailer.js');

const rec = createRecorder('54-public-site');
const { ok, bad, eq } = rec;
const BASE = 'http://localhost:6047';

async function api(method, p, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(BASE + p, opts);
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: data };
}

async function main() {
  const epg = await startEmbeddedPostgres('54-public-site', PG_PORT);
  try {
    runMigrateUp();
    const server = createApp().listen(6047);
    try {
      const contact = { full_name: 'Pat Lee', email: 'pat@example.com', message: 'Hello there' };
      const demo = { full_name: 'Sam Roe', email: 'sam@example.com', organization: 'Roe Transit' };

      console.log('--- Contact us ---');
      mailer._reset();
      eq('business question -> 200', (await api('POST', '/public/contact', { ...contact, topic: 'business' })).status, 200);
      eq('technical support -> 200', (await api('POST', '/public/contact', { ...contact, topic: 'support', phone: '555-0100' })).status, 200);
      const sent = mailer._sent();
      eq('business goes to admin@safeturns.com', sent[0]?.to, 'admin@safeturns.com');
      eq('support goes to support@safeturns.com', sent[1]?.to, 'support@safeturns.com');
      (/pat@example\.com/.test(sent[0]?.text) && /Hello there/.test(sent[0]?.text)) ? ok('email carries sender and message') : bad(`text: ${sent[0]?.text}`);
      eq('an unknown topic -> 400', (await api('POST', '/public/contact', { ...contact, topic: 'sales' })).status, 400);

      mailer._failWith(new Error('mail down'));
      eq('a failed send is reported -> 502', (await api('POST', '/public/contact', { ...contact, topic: 'business' })).status, 502);
      mailer._failWith(null);

      console.log('\n--- Book a demo ---');
      mailer._reset();
      const made = await api('POST', '/public/demo-request', { ...demo, audience: 'company', message: 'Ten vans' });
      eq('company demo request -> 201', made.status, 201);
      eq('school demo request -> 201', (await api('POST', '/public/demo-request', { ...demo, audience: 'school', organization: 'Elm School' })).status, 201);
      const rows = (await pool.query('SELECT audience, organization, email FROM demo_requests ORDER BY created_at')).rows;
      eq('both saved', rows.map((r) => `${r.audience}:${r.organization}`).join(','), 'company:Roe Transit,school:Elm School');
      const demoMail = await mailer._drained();
      eq('two emails to admin@safeturns.com', demoMail.filter((m) => m.to === 'admin@safeturns.com').length, 2);
      eq('a bad email -> 400', (await api('POST', '/public/demo-request', { ...demo, audience: 'school', email: 'nope' })).status, 400);

      console.log('\n--- rate limit: 7 calls per window, shared by both forms ---');
      const limited = await api('POST', '/public/contact', { ...contact, topic: 'business' });
      (limited.status === 429 && /too many messages/.test(limited.body?.error ?? '')) ? ok('8th call -> 429') : bad(`8th: ${limited.status} ${JSON.stringify(limited.body)}`);
      eq('the blocked demo request saved nothing', (await api('POST', '/public/demo-request', { ...demo, audience: 'company' })).status, 429);
      eq('still 2 rows', (await pool.query('SELECT count(*)::int AS n FROM demo_requests')).rows[0].n, 2);
      eq('login is not affected', (await api('POST', '/auth/login', { email: 'x@example.com', password: 'Wrong123!' })).status, 401);
    } finally {
      server.close();
    }
  } finally {
    try { await pool.end(); } catch { /* already ended */ }
    await epg.stop();
  }
  const { fail } = rec.summarize();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
