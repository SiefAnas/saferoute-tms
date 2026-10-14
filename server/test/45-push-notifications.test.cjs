// Push notifications foundation (branch push-notifications): device tokens (save, move to a new
// user, remove on logout without a session, cap per user), sendPush (Expo + Web Push, payload,
// record of every send, dead tokens dropped, deactivated users, retries), scheduled sends (wait,
// sweep, cancel, no double send), and the in-app list (newest first, unread count, read / read-all,
// only your own). The Expo push service and the browser push endpoints are fakes on localhost.
const PG_PORT = 5521;
const HTTP_PORT = 6045;
const FAKE_PORT = 6046;
process.env.DATABASE_URL = `postgres://saferoute:saferoute@localhost:${PG_PORT}/saferoute_dev`;
process.env.JWT_SECRET = 'test-secret-45';
process.env.NODE_ENV = 'test';
process.env.EXPO_PUSH_URL = `http://localhost:${FAKE_PORT}/expo/send`;
process.env.EXPO_RECEIPTS_URL = `http://localhost:${FAKE_PORT}/expo/receipts`;
const webpush = require('web-push');
const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.VAPID_SUBJECT = 'mailto:test@example.test';

const http = require('node:http');
const crypto = require('node:crypto');
const { createRecorder, startEmbeddedPostgres, runMigrateUp } = require('./lib/testkit.cjs');
const createApp = require('../src/app.js');
const pool = require('../src/db/pool.js');
const { hashPassword } = require('../src/auth/password.js');
const push = require('../src/services/push.js');

const rec = createRecorder('45-push-notifications');
const { ok, bad, eq } = rec;
const BASE = `http://localhost:${HTTP_PORT}`;
const PW = 'Secret123!';

async function api(method, p, token, body) {
  const opts = { method, headers: {} };
  if (token) opts.headers.authorization = `Bearer ${token}`;
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(BASE + p, opts);
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: data };
}
const login = async (email) => (await api('POST', '/auth/login', null, { email, password: PW })).body.token;

// ---- Fake push services ----
const fake = {
  expoCalls: [], // arrays of messages
  expoMode: 'ok', // 'ok' | 'down'
  deadExpo: new Set(), // tokens answered with DeviceNotRegistered
  receipts: {}, // ticket id -> receipt
  webCalls: [], // { path, encoding }
  goneWeb: new Set(), // endpoint paths answered 410
};
let ticketSeq = 0;
function startFake() {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(obj ? JSON.stringify(obj) : ''); };
      if (req.url === '/expo/send') {
        if (fake.expoMode === 'down') return send(503, { errors: [{ message: 'down' }] });
        const messages = JSON.parse(raw);
        fake.expoCalls.push(messages);
        return send(200, {
          data: messages.map((m) => (fake.deadExpo.has(m.to)
            ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok', id: `ticket-${++ticketSeq}` })),
        });
      }
      if (req.url === '/expo/receipts') {
        const { ids } = JSON.parse(raw);
        return send(200, { data: Object.fromEntries(ids.filter((id) => fake.receipts[id]).map((id) => [id, fake.receipts[id]])) });
      }
      if (req.url.startsWith('/wp/')) {
        fake.webCalls.push({ path: req.url, encoding: req.headers['content-encoding'], auth: req.headers.authorization ?? '' });
        return send(fake.goneWeb.has(req.url) ? 410 : 201);
      }
      send(404);
    });
  });
  return new Promise((resolve) => server.listen(FAKE_PORT, () => resolve(server)));
}
function webSubscription(path) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `http://localhost:${FAKE_PORT}/wp/${path}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
  };
}
const tokensOf = async (userId) => (await pool.query('SELECT token FROM push_tokens WHERE user_id = $1 ORDER BY token', [userId])).rows.map((r) => r.token);
const notif = async (id) => (await pool.query('SELECT * FROM notifications WHERE id = $1', [id])).rows[0];
const allMessages = () => fake.expoCalls.flat();

async function main() {
  const epg = await startEmbeddedPostgres('45-push-notifications', PG_PORT);
  const fakeServer = await startFake();
  try {
    runMigrateUp();
    // web-push always speaks HTTPS; the fake endpoints are plain HTTP on localhost. Send the exact
    // request web-push builds (encrypted payload, VAPID signature) over HTTP instead.
    push.setTransportsForTest({
      webPushFn: async (subscription, payload, options) => {
        const d = webpush.generateRequestDetails(subscription, payload, options);
        const r = await fetch(d.endpoint, { method: d.method, headers: d.headers, body: d.body });
        if (r.status >= 400) { const err = new Error(`status ${r.status}`); err.statusCode = r.status; throw err; }
      },
    });
    const hash = await hashPassword(PW);
    const ins = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
    const A = await ins("INSERT INTO companies(name,claim_status,claimed_at) VALUES('Co A','claimed',now()) RETURNING id");
    const S = await ins("INSERT INTO schools(name,claim_status,claimed_at) VALUES('School S','claimed',now()) RETURNING id");
    const user = (email, role, tenant) => ins(
      `INSERT INTO users(email,password_hash,full_name,role,${role.startsWith('school') ? 'school_id' : 'company_id'},email_verified_at)
       VALUES($1,$2,$3,$4,$5,now()) RETURNING id`,
      [email, hash, email.split('@')[0], role, tenant]
    );
    const driver = await user('driver@a.example.test', 'driver', A.id);
    const monitor = await user('monitor@a.example.test', 'monitor', A.id);
    const staff = await user('staff@s.example.test', 'school_staff', S.id);

    const app = createApp();
    const server = app.listen(HTTP_PORT);
    try {
      const tDriver = await login('driver@a.example.test');
      const tMonitor = await login('monitor@a.example.test');
      const tStaff = await login('staff@s.example.test');

      console.log('--- device tokens ---');
      const PHONE = 'ExponentPushToken[driver-phone]';
      const TABLET = 'ExponentPushToken[driver-tablet]';
      eq('register needs a session -> 401', (await api('POST', '/notifications/devices', null, { token: PHONE })).status, 401);
      eq('a non-Expo token is refused -> 400', (await api('POST', '/notifications/devices', tDriver, { token: 'abc' })).status, 400);
      eq('an unknown kind is refused -> 400', (await api('POST', '/notifications/devices', tDriver, { kind: 'sms', token: PHONE })).status, 400);
      const reg = await api('POST', '/notifications/devices', tDriver, { kind: 'expo', token: PHONE, platform: 'ios', device_name: 'iPhone' });
      eq('driver registers their phone -> 201', reg.status, 201);
      ok(reg.body && !('token' in reg.body) ? 'the response does not echo the token back' : `response: ${JSON.stringify(reg.body)}`);
      eq('registering the same phone again keeps one row', (await api('POST', '/notifications/devices', tDriver, { token: PHONE, platform: 'ios' })).status, 201);
      await api('POST', '/notifications/devices', tDriver, { token: TABLET, platform: 'android' });
      eq('phone + tablet: two devices for one person', (await tokensOf(driver.id)).join(','), [PHONE, TABLET].sort().join(','));
      const sub = webSubscription('driver-browser');
      eq('a browser subscription registers -> 201', (await api('POST', '/notifications/devices', tDriver, { kind: 'web', subscription: sub })).status, 201);
      eq('a web subscription without keys -> 400', (await api('POST', '/notifications/devices', tDriver, { kind: 'web', subscription: { endpoint: sub.endpoint } })).status, 400);
      eq('a web subscription that is not a URL -> 400', (await api('POST', '/notifications/devices', tDriver, { kind: 'web', subscription: { ...sub, endpoint: 'nope' } })).status, 400);

      // The driver hands the tablet to the monitor, who signs in on it.
      await api('POST', '/notifications/devices', tMonitor, { token: TABLET, platform: 'android' });
      eq('a device someone else signs in on moves to them', `${(await tokensOf(driver.id)).includes(TABLET)} ${(await tokensOf(monitor.id)).join()}`, `false ${TABLET}`);

      for (let i = 0; i < 12; i += 1) await api('POST', '/notifications/devices', tStaff, { token: `ExponentPushToken[staff-${String(i).padStart(2, '0')}]` });
      const staffTokens = await tokensOf(staff.id);
      eq('at most 10 devices per person; the least recently seen go', `${staffTokens.length} ${staffTokens.includes('ExponentPushToken[staff-00]')} ${staffTokens.includes('ExponentPushToken[staff-11]')}`, '10 false true');

      eq('logout: removing a device needs no session -> 204', (await api('DELETE', '/notifications/devices', null, { token: 'ExponentPushToken[staff-11]' })).status, 204);
      eq('the removed device is gone', (await tokensOf(staff.id)).includes('ExponentPushToken[staff-11]'), false);
      eq('removing without a token -> 400', (await api('DELETE', '/notifications/devices', null, {})).status, 400);
      eq('the web push key is public', (await api('GET', '/notifications/web-push-key')).body?.public_key, vapid.publicKey);

      console.log('\n--- send now ---');
      fake.expoCalls = [];
      const n1 = await push.sendPush(driver.id, 'Shift starts soon', 'Your morning run starts at 7:00.', { route: '/(driver)/today', web_route: '/driver' }, { category: 'test' });
      eq('sendPush stores the notification as sent', n1.status, 'sent');
      const msgs = allMessages();
      eq('one Expo message (the phone; the tablet moved away)', msgs.map((m) => m.to).join(), PHONE);
      eq('the message has the title and body', `${msgs[0]?.title}|${msgs[0]?.body}`, 'Shift starts soon|Your morning run starts at 7:00.');
      eq('data carries the route and the notification id (to mark it read on tap)', `${msgs[0]?.data?.route}|${msgs[0]?.data?.notification_id}`, `/(driver)/today|${n1.id}`);
      eq('high priority + sound + Android channel, so it shows when the app is closed', `${msgs[0]?.priority} ${msgs[0]?.sound} ${msgs[0]?.channelId}`, 'high default default');
      const webCall = fake.webCalls.find((c) => c.path === '/wp/driver-browser');
      ok(webCall ? 'the browser subscription got an encrypted Web Push' : 'no web push was sent');
      eq('web push is encrypted (aes128gcm) and VAPID-signed', `${webCall?.encoding} ${/^vapid /.test(webCall?.auth ?? '')}`, 'aes128gcm true');
      const deliveries = (await pool.query('SELECT kind, status, ticket_id FROM notification_deliveries WHERE notification_id = $1 ORDER BY kind', [n1.id])).rows;
      eq('every device send is recorded', deliveries.map((d) => `${d.kind}:${d.status}`).join(), 'expo:ok,web:ok');
      ok(deliveries.find((d) => d.kind === 'expo')?.ticket_id ? 'the Expo ticket id is kept (for the receipt check)' : 'no ticket id stored');

      eq('a person with no devices still gets the record', (await push.sendPush(staff.id, 'Hello', 'For the list only')).status, 'sent');
      for (const [label, args] of [
        ['empty title', ['', 'b']],
        ['empty body', ['t', '  ']],
        ['data not an object', ['t', 'b', 'x']],
        ['route without a leading slash', ['t', 'b', { route: 'driver/today' }]],
        ['data over 2 KB', ['t', 'b', { blob: 'x'.repeat(3000) }]],
      ]) {
        let status = null;
        try { await push.sendPush(driver.id, ...args); } catch (err) { status = err.status; }
        eq(`refused: ${label} -> 400`, status, 400);
      }

      console.log('\n--- dead devices ---');
      fake.deadExpo.add(PHONE);
      fake.goneWeb.add('/wp/driver-browser');
      await push.sendPush(driver.id, 'Again', 'Second one');
      eq('DeviceNotRegistered and a 410 browser subscription remove those tokens', (await tokensOf(driver.id)).length, 0);
      fake.deadExpo.clear();
      fake.goneWeb.clear();

      // Receipts: Expo accepted it, but later says the app was uninstalled.
      await api('POST', '/notifications/devices', tDriver, { token: PHONE, platform: 'ios' });
      const n2 = await push.sendPush(driver.id, 'Receipt test', 'r');
      const ticket = (await pool.query('SELECT ticket_id FROM notification_deliveries WHERE notification_id = $1', [n2.id])).rows[0].ticket_id;
      fake.receipts[ticket] = { status: 'error', details: { error: 'DeviceNotRegistered' } };
      ok((await push.checkExpoReceipts({ olderThanMinutes: 0 })) >= 1 ? 'the receipt check reads the tickets' : 'no receipts checked');
      eq('a DeviceNotRegistered receipt removes the token', (await tokensOf(driver.id)).length, 0);
      eq('the receipt is recorded', (await pool.query('SELECT receipt_status FROM notification_deliveries WHERE notification_id = $1', [n2.id])).rows[0].receipt_status, 'DeviceNotRegistered');

      console.log('\n--- push service down: retry ---');
      await api('POST', '/notifications/devices', tDriver, { token: PHONE, platform: 'ios' });
      fake.expoMode = 'down';
      const n3 = await push.sendPush(driver.id, 'Retry me', 'r');
      eq('Expo unreachable -> rescheduled, not lost', `${n3.status} ${n3.attempts}`, 'scheduled 1');
      ok(new Date(n3.send_at) > new Date() ? 'retry is pushed into the future (backoff)' : 'no backoff');
      fake.expoMode = 'ok';
      await pool.query("UPDATE notifications SET send_at = now() - interval '1 second' WHERE id = $1", [n3.id]);
      await push.sendDueNotifications();
      eq('the sweep sends the retry once the service is back', (await notif(n3.id)).status, 'sent');

      console.log('\n--- deactivated ---');
      fake.expoCalls = [];
      await pool.query('UPDATE users SET is_active = false WHERE id = $1', [monitor.id]);
      const n4 = await push.sendPush(monitor.id, 'You are off', 'x');
      eq('a deactivated person gets no push, but the record is kept', `${allMessages().length} ${n4.status}`, '0 sent');
      await pool.query('UPDATE users SET is_active = true WHERE id = $1', [monitor.id]);

      console.log('\n--- scheduled sends ---');
      fake.expoCalls = [];
      const later = await push.sendPush(driver.id, 'Reminder', 'In an hour', { route: '/(driver)/today' }, { sendAt: new Date(Date.now() + 3600_000), category: 'reminder' });
      eq('a future send waits as scheduled', later.status, 'scheduled');
      eq('nothing is pushed yet', allMessages().length, 0);
      eq('the sweep leaves it alone until it is due', await push.sendDueNotifications(), 0);
      const listBefore = (await api('GET', '/notifications', tDriver)).body;
      eq('a scheduled notification is not in the list yet', listBefore.items.some((i) => i.id === later.id), false);
      await pool.query("UPDATE notifications SET send_at = now() - interval '1 second' WHERE id = $1", [later.id]);
      // Two sweeps at once (two API instances, or the API + the cron script): it goes out once.
      const [a, b] = await Promise.all([push.sendDueNotifications(), push.sendDueNotifications()]);
      eq('two sweeps at once send it exactly once', `${a + b} ${allMessages().length}`, '1 1');
      eq('once due it is sent', (await notif(later.id)).status, 'sent');

      const cancel1 = await push.sendPush(driver.id, 'Cancel me', 'x', {}, { sendAt: new Date(Date.now() + 60_000), category: 'reminder' });
      const cancel2 = await push.sendPush(driver.id, 'Cancel me too', 'x', {}, { sendAt: new Date(Date.now() + 60_000), category: 'reminder' });
      eq('cancel by id', await push.cancelScheduled({ id: cancel1.id }), 1);
      eq('cancel by user + category', await push.cancelScheduled({ userId: driver.id, category: 'reminder' }), 1);
      eq('cancelled sends never go out', `${(await notif(cancel1.id)).status} ${(await notif(cancel2.id)).status}`, 'cancelled cancelled');
      eq('cancelling something already sent changes nothing', await push.cancelScheduled({ id: later.id }), 0);

      // A sender that died mid-send leaves the row 'sending'; it is picked up again after 5 minutes.
      const stuck = await push.sendPush(driver.id, 'Stuck', 'x', {}, { sendAt: new Date(Date.now() + 60_000) });
      await pool.query("UPDATE notifications SET status = 'sending', claimed_at = now() - interval '10 minutes', send_at = now() - interval '10 minutes' WHERE id = $1", [stuck.id]);
      await push.sendDueNotifications();
      eq('a stuck send is retried by the sweep', (await notif(stuck.id)).status, 'sent');

      console.log('\n--- in-app list, read / unread ---');
      eq('the list needs a session -> 401', (await api('GET', '/notifications')).status, 401);
      const list = (await api('GET', '/notifications', tDriver)).body;
      const sentCount = (await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND status = 'sent'", [driver.id])).rows[0].n;
      eq('the list has every sent notification', list.items.length, sentCount);
      eq('unread count = all of them at first', list.unread_count, sentCount);
      ok(list.items.every((x, i) => i === 0 || x.sent_at <= list.items[i - 1].sent_at) ? 'newest first' : 'not sorted newest first');
      eq('items carry the route for tapping', list.items.find((x) => x.id === n1.id)?.data?.route, '/(driver)/today');
      eq('limit works', (await api('GET', '/notifications?limit=2', tDriver)).body.items.length, 2);
      const read = await api('POST', `/notifications/${n1.id}/read`, tDriver);
      eq('mark one read -> 200', read.status, 200);
      ok(read.body?.read_at ? 'read_at is set' : 'read_at missing');
      eq('unread count drops by one', read.body?.unread_count, sentCount - 1);
      eq('GET /notifications/unread-count agrees', (await api('GET', '/notifications/unread-count', tDriver)).body.unread_count, sentCount - 1);
      const readAgain = await api('POST', `/notifications/${n1.id}/read`, tDriver);
      eq('marking it read again keeps the first read time', readAgain.body?.read_at, read.body?.read_at);
      eq("someone else's notification -> 404", (await api('POST', `/notifications/${n1.id}/read`, tStaff)).status, 404);
      eq('a bad id -> 404', (await api('POST', '/notifications/not-a-uuid/read', tDriver)).status, 404);
      eq("staff's list holds only their own", (await api('GET', '/notifications', tStaff)).body.items.map((i) => i.title).join(), 'Hello');
      const all = await api('POST', '/notifications/read-all', tDriver);
      eq('read-all -> unread 0', `${all.status} ${all.body?.unread_count}`, '200 0');
      eq('after read-all the count is 0', (await api('GET', '/notifications/unread-count', tDriver)).body.unread_count, 0);
      eq("read-all didn't touch staff's unread", (await api('GET', '/notifications/unread-count', tStaff)).body.unread_count, 1);
    } finally {
      server.close();
    }
  } finally {
    fakeServer.close();
    try { await pool.end(); } catch { /* already ended */ }
    await epg.stop();
  }
  const { fail } = rec.summarize();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
