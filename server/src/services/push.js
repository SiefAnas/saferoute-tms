// Push notifications (branch push-notifications): the one way any feature notifies a person.
//
//   sendPush(userId, title, body, data, { sendAt, category })
//
// Every call is stored in `notifications` first (the record, and the in-app list), then pushed to
// every device the person is signed in on (`push_tokens`):
//   - mobile app: through the Expo push service (exp.host), which hands it to Apple (APNs) and
//     Google (FCM). The phone's OS shows it even when the app is closed.
//   - website: browser Web Push (VAPID keys in config). The service worker (client/public/sw.js)
//     shows it even when no SafeTurns tab is open, as long as the browser is running.
//
// Scheduling: a notification with a future `sendAt` waits in the table with status 'scheduled'.
// sendDueNotifications() (run every NOTIFICATION_SWEEP_MS by src/index.js, or by
// scripts/send-due-notifications.js from a cron job) claims what has come due with
// FOR UPDATE SKIP LOCKED, so two API instances never send the same one twice.
//
// data.route is the screen to open when the notification is tapped (mobile route, e.g.
// '/(driver)/today'); data.web_route is the website path if it differs (else route is used).
// data.notification_id is added on send so the apps can mark it read.
const webpush = require('web-push');
const pool = require('../db/pool');
const { HttpError } = require('../errors');
const config = require('../config');

const MAX_TITLE = 200;
const MAX_BODY = 2000;
// Expo and Web Push both cap the payload at about 4 KB; leave room for title, body and our ids.
const MAX_DATA_BYTES = 2048;
const MAX_ATTEMPTS = 5;
// A claimed notification whose sender died mid-send is retried after this long.
const STALE_CLAIM = "interval '5 minutes'";
const EXPO_CHUNK = 100; // Expo accepts at most 100 messages per request
const EXPO_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

// Overridable by tests (same pattern as mail/mailer.js).
let fetchImpl = (...args) => fetch(...args);
let webPushSend = (...args) => webpush.sendNotification(...args);
function setTransportsForTest({ fetchFn, webPushFn } = {}) {
  fetchImpl = fetchFn ?? ((...args) => fetch(...args));
  webPushSend = webPushFn ?? ((...args) => webpush.sendNotification(...args));
}

const webPushConfigured = () => Boolean(config.vapidPublicKey && config.vapidPrivateKey);

function validateMessage(title, body, data) {
  if (typeof title !== 'string' || !title.trim()) throw new HttpError(400, 'title is required');
  if (typeof body !== 'string' || !body.trim()) throw new HttpError(400, 'body is required');
  if (title.length > MAX_TITLE) throw new HttpError(400, `title must be ${MAX_TITLE} characters or fewer`);
  if (body.length > MAX_BODY) throw new HttpError(400, `body must be ${MAX_BODY} characters or fewer`);
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'data must be an object');
  for (const key of ['route', 'web_route']) {
    if (data[key] !== undefined && (typeof data[key] !== 'string' || !data[key].startsWith('/'))) {
      throw new HttpError(400, `data.${key} must be an app path starting with /`);
    }
  }
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_DATA_BYTES) throw new HttpError(400, `data must be ${MAX_DATA_BYTES} bytes or less`);
}

// The one entry point. Returns the stored notification. Sends now when sendAt is missing or not
// in the future; otherwise it waits for the sweep. category lets a feature find its own later
// (cancelScheduled), e.g. 'shift_reminder'.
async function sendPush(userId, title, body, data = {}, { sendAt = null, category = null } = {}) {
  validateMessage(title, body, data);
  let when = null;
  if (sendAt !== null && sendAt !== undefined) {
    when = new Date(sendAt);
    if (Number.isNaN(when.getTime())) throw new HttpError(400, 'sendAt must be a date');
  }
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, title, body, data, category, send_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, COALESCE($6::timestamptz, now()))
     RETURNING *, send_at <= now() AS due`,
    [userId, title.trim(), body.trim(), JSON.stringify(data), category, when ? when.toISOString() : null]
  );
  const { due, ...n } = rows[0];
  // "Due" is decided by the database clock, the same clock the sweep uses.
  if (!due) return n;

  // Due now: claim it (the sweep may not race us, but the claim keeps it to one sender) and send.
  const claimed = await pool.query(
    `UPDATE notifications SET status = 'sending', claimed_at = now(), attempts = attempts + 1
      WHERE id = $1 AND status = 'scheduled' RETURNING *`,
    [n.id]
  );
  if (!claimed.rows[0]) return n;
  return deliver(claimed.rows[0]);
}

// Cancel scheduled sends that haven't gone out: by id, or every one of a user's in a category.
async function cancelScheduled({ id, userId, category } = {}) {
  if (!id && !(userId && category)) throw new Error('cancelScheduled needs an id, or a userId and a category');
  const { rowCount } = await pool.query(
    `UPDATE notifications SET status = 'cancelled'
      WHERE status = 'scheduled' AND ${id ? 'id = $1' : 'user_id = $1 AND category = $2'}`,
    id ? [id] : [userId, category]
  );
  return rowCount;
}

// ---- Delivery ----

async function sendExpo(tokens, n) {
  const results = [];
  for (let i = 0; i < tokens.length; i += EXPO_CHUNK) {
    const chunk = tokens.slice(i, i + EXPO_CHUNK);
    const messages = chunk.map((t) => ({
      to: t.token,
      title: n.title,
      body: n.body,
      data: { ...n.data, notification_id: n.id },
      sound: 'default',
      priority: 'high',
      channelId: 'default',
    }));
    try {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (config.expoAccessToken) headers.Authorization = `Bearer ${config.expoAccessToken}`;
      const res = await fetchImpl(config.expoPushUrl, { method: 'POST', headers, body: JSON.stringify(messages) });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(payload?.data)) {
        const msg = `expo ${res.status}: ${JSON.stringify(payload?.errors ?? payload)?.slice(0, 300)}`;
        chunk.forEach((t) => results.push({ token: t, status: 'error', error: msg, transport: true }));
        continue;
      }
      chunk.forEach((t, j) => {
        const ticket = payload.data[j] ?? { status: 'error', message: 'no ticket' };
        if (ticket.status === 'ok') results.push({ token: t, status: 'ok', ticketId: ticket.id ?? null });
        else results.push({ token: t, status: 'error', error: ticket.details?.error ?? ticket.message ?? 'error' });
      });
    } catch (err) {
      chunk.forEach((t) => results.push({ token: t, status: 'error', error: `expo request failed: ${err.message}`, transport: true }));
    }
  }
  return results;
}

async function sendWeb(tokens, n) {
  if (!webPushConfigured()) return tokens.map((t) => ({ token: t, status: 'error', error: 'web push is not configured (VAPID keys)' }));
  const payload = JSON.stringify({ title: n.title, body: n.body, data: { ...n.data, notification_id: n.id } });
  const options = {
    TTL: 24 * 3600,
    vapidDetails: { subject: config.vapidSubject, publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey },
  };
  return Promise.all(tokens.map(async (t) => {
    try {
      await webPushSend({ endpoint: t.token, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, options);
      return { token: t, status: 'ok' };
    } catch (err) {
      // 404 / 410: the browser dropped the subscription (unsubscribed, cleared data).
      const gone = err.statusCode === 404 || err.statusCode === 410;
      return { token: t, status: 'error', error: gone ? 'SubscriptionGone' : `web push failed: ${err.statusCode ?? ''} ${err.message}`.trim(), transport: !gone };
    }
  }));
}

// Errors that mean the device will never accept a push again: drop its token.
const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'SubscriptionGone']);

async function deliver(n) {
  const { rows: users } = await pool.query('SELECT is_active FROM users WHERE id = $1', [n.user_id]);
  // A deactivated person keeps the record but gets no push.
  const tokens = users[0]?.is_active
    ? (await pool.query('SELECT * FROM push_tokens WHERE user_id = $1', [n.user_id])).rows
    : [];

  const results = [
    ...(await sendExpo(tokens.filter((t) => t.kind === 'expo'), n)),
    ...(await sendWeb(tokens.filter((t) => t.kind === 'web'), n)),
  ];

  for (const r of results) {
    await pool.query(
      `INSERT INTO notification_deliveries (notification_id, push_token_id, kind, status, error, ticket_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [n.id, r.token.id, r.token.kind, r.status, r.error ?? null, r.ticketId ?? null]
    );
  }
  const dead = results.filter((r) => DEAD_TOKEN_ERRORS.has(r.error)).map((r) => r.token.id);
  if (dead.length) await pool.query('DELETE FROM push_tokens WHERE id = ANY($1::uuid[])', [dead]);

  // Nothing got through only because the push services were unreachable: try again later
  // (back off 1, 2, 4, 8 minutes), up to MAX_ATTEMPTS, then keep the record as sent anyway so
  // it still shows in the app's list.
  const allTransportFailed = results.length > 0 && results.every((r) => r.status === 'error' && r.transport);
  const lastError = results.find((r) => r.status === 'error')?.error ?? null;
  if (allTransportFailed && n.attempts < MAX_ATTEMPTS) {
    const { rows } = await pool.query(
      `UPDATE notifications SET status = 'scheduled', claimed_at = NULL, last_error = $2,
              send_at = now() + make_interval(mins => $3)
        WHERE id = $1 RETURNING *`,
      [n.id, lastError, 2 ** (n.attempts - 1)]
    );
    return rows[0];
  }
  const { rows } = await pool.query(
    `UPDATE notifications SET status = 'sent', sent_at = now(), claimed_at = NULL, last_error = $2
      WHERE id = $1 RETURNING *`,
    [n.id, lastError]
  );
  return rows[0];
}

// Sweep: send everything that has come due (scheduled sends, retries, sends whose sender died).
// Safe to run from several processes at once. Returns how many were handled.
async function sendDueNotifications({ batch = 50 } = {}) {
  let handled = 0;
  for (;;) {
    const { rows } = await pool.query(
      `UPDATE notifications SET status = 'sending', claimed_at = now(), attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM notifications
           WHERE (status = 'scheduled' AND send_at <= now())
              OR (status = 'sending' AND claimed_at < now() - ${STALE_CLAIM})
           ORDER BY send_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      [batch]
    );
    for (const n of rows) {
      try {
        await deliver(n);
      } catch (err) {
        console.error('[push] delivery failed', n.id, err);
        await pool.query(
          `UPDATE notifications SET status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'scheduled' END,
                  claimed_at = NULL, last_error = $2, send_at = now() + interval '1 minute'
            WHERE id = $1`,
          [n.id, String(err.message).slice(0, 500), MAX_ATTEMPTS]
        );
      }
    }
    handled += rows.length;
    if (rows.length < batch) return handled;
  }
}

// Expo answers a send with a ticket; whether Apple / Google actually took it comes later as a
// receipt (ask after ~15 minutes). A DeviceNotRegistered receipt means the app was uninstalled or
// the phone replaced: the token is removed so we stop sending to it.
async function checkExpoReceipts({ olderThanMinutes = 15 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, ticket_id, push_token_id FROM notification_deliveries
      WHERE ticket_id IS NOT NULL AND receipt_checked_at IS NULL
        AND created_at < now() - make_interval(mins => $1)
      ORDER BY created_at LIMIT 1000`,
    [olderThanMinutes]
  );
  if (rows.length === 0) return 0;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (config.expoAccessToken) headers.Authorization = `Bearer ${config.expoAccessToken}`;
  let receipts;
  try {
    const res = await fetchImpl(config.expoReceiptsUrl, { method: 'POST', headers, body: JSON.stringify({ ids: rows.map((r) => r.ticket_id) }) });
    receipts = (await res.json())?.data ?? {};
  } catch (err) {
    console.error('[push] receipts check failed', err.message);
    return 0;
  }
  const dead = [];
  for (const r of rows) {
    const receipt = receipts[r.ticket_id];
    const status = !receipt ? 'unknown' : receipt.status === 'ok' ? 'ok' : (receipt.details?.error ?? 'error');
    if (status === 'DeviceNotRegistered' && r.push_token_id) dead.push(r.push_token_id);
    await pool.query('UPDATE notification_deliveries SET receipt_status = $2, receipt_checked_at = now() WHERE id = $1', [r.id, status]);
  }
  if (dead.length) await pool.query('DELETE FROM push_tokens WHERE id = ANY($1::uuid[])', [dead]);
  return rows.length;
}

// ---- Devices ----

// POST /notifications/devices. Mobile: { kind: 'expo', token, platform, device_name }.
// Website: { kind: 'web', subscription: { endpoint, keys: { p256dh, auth } } }.
// A token belongs to whoever registered it last (a handed-over or shared device moves to the new
// person). Each person keeps at most MAX_DEVICES; registering more drops the least recently seen.
const MAX_DEVICES = 10;
async function registerDevice(req, body = {}) {
  const kind = body.kind ?? 'expo';
  let token;
  let p256dh = null;
  let auth = null;
  if (kind === 'expo') {
    token = body.token;
    if (typeof token !== 'string' || !EXPO_TOKEN_RE.test(token)) throw new HttpError(400, 'token must be an Expo push token');
  } else if (kind === 'web') {
    const sub = body.subscription ?? {};
    token = sub.endpoint;
    p256dh = sub.keys?.p256dh;
    auth = sub.keys?.auth;
    let url = null;
    try { url = new URL(token); } catch { /* checked below */ }
    const okProtocol = url && (url.protocol === 'https:' || (config.nodeEnv !== 'production' && url.protocol === 'http:'));
    if (!okProtocol || typeof p256dh !== 'string' || typeof auth !== 'string' || token.length > 1000) {
      throw new HttpError(400, 'subscription must be a browser push subscription (endpoint and keys)');
    }
  } else {
    throw new HttpError(400, "kind must be 'expo' or 'web'");
  }
  const platform = ['ios', 'android', 'web'].includes(body.platform) ? body.platform : (kind === 'web' ? 'web' : null);
  const deviceName = typeof body.device_name === 'string' ? body.device_name.slice(0, 100) : null;

  const { rows } = await pool.query(
    `INSERT INTO push_tokens (user_id, kind, token, p256dh, auth, platform, device_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (token) DO UPDATE
       SET user_id = EXCLUDED.user_id, kind = EXCLUDED.kind, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           platform = EXCLUDED.platform, device_name = EXCLUDED.device_name, last_seen_at = now()
     RETURNING id, kind, platform, device_name, created_at, last_seen_at`,
    [req.auth.userId, kind, token, p256dh, auth, platform, deviceName]
  );
  await pool.query(
    `DELETE FROM push_tokens WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM push_tokens WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT ${MAX_DEVICES})`,
    [req.auth.userId]
  );
  return rows[0];
}

// DELETE /notifications/devices { token } (or { subscription: { endpoint } }). Works without a
// valid session on purpose: a phone whose session expired must still be able to stop pushes for
// the person who was signed in on it. Knowing the device's own token is the proof.
async function unregisterDevice(body = {}) {
  const token = body.token ?? body.subscription?.endpoint;
  if (typeof token !== 'string' || !token) throw new HttpError(400, 'token is required');
  await pool.query('DELETE FROM push_tokens WHERE token = $1', [token]);
}

// ---- In-app list ----

function publicNotification(n) {
  return { id: n.id, title: n.title, body: n.body, data: n.data, category: n.category, sent_at: n.sent_at, read_at: n.read_at };
}

async function unreadCount(userId) {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND status = 'sent' AND read_at IS NULL",
    [userId]
  );
  return rows[0].n;
}

// GET /notifications?limit=&before= : the person's sent notifications, newest first (scheduled
// ones that haven't gone out yet are not shown), plus the unread count for the bell.
// Optional filters: kind (data.kind, e.g. 'monitor_alert' for the admin's red banner), unread=1,
// since=<iso> (sent after).
async function listNotifications(req, { limit, before, kind, unread, since } = {}) {
  const n = Math.min(Math.max(Number.parseInt(limit, 10) || 30, 1), 100);
  let beforeDate = null;
  if (before) {
    beforeDate = new Date(before);
    if (Number.isNaN(beforeDate.getTime())) throw new HttpError(400, 'before must be a date');
  }
  let sinceDate = null;
  if (since) {
    sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) throw new HttpError(400, 'since must be a date');
  }
  const { rows } = await pool.query(
    `SELECT * FROM notifications
      WHERE user_id = $1 AND status = 'sent' AND ($2::timestamptz IS NULL OR sent_at < $2)
        AND ($4::text IS NULL OR data->>'kind' = $4)
        AND (NOT $5 OR read_at IS NULL)
        AND ($6::timestamptz IS NULL OR sent_at > $6)
      ORDER BY sent_at DESC LIMIT $3`,
    [req.auth.userId, beforeDate ? beforeDate.toISOString() : null, n, typeof kind === 'string' && kind ? kind : null,
      unread === '1' || unread === 'true' || unread === true, sinceDate ? sinceDate.toISOString() : null]
  );
  return { items: rows.map(publicNotification), unread_count: await unreadCount(req.auth.userId) };
}

async function markRead(req, id) {
  const { rows } = await pool.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, now())
      WHERE id::text = $1 AND user_id = $2 AND status = 'sent' RETURNING *`,
    [String(id), req.auth.userId]
  );
  if (!rows[0]) throw new HttpError(404, 'notification not found');
  return { ...publicNotification(rows[0]), unread_count: await unreadCount(req.auth.userId) };
}

async function markAllRead(req) {
  const { rowCount } = await pool.query(
    "UPDATE notifications SET read_at = now() WHERE user_id = $1 AND status = 'sent' AND read_at IS NULL",
    [req.auth.userId]
  );
  return { updated: rowCount, unread_count: 0 };
}

module.exports = {
  sendPush,
  cancelScheduled,
  sendDueNotifications,
  checkExpoReceipts,
  registerDevice,
  unregisterDevice,
  listNotifications,
  markRead,
  markAllRead,
  unreadCount,
  webPushConfigured,
  setTransportsForTest,
};
