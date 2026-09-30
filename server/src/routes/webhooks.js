// Mail provider callbacks (Resend). Resend signs every webhook through Svix:
//   headers  svix-id, svix-timestamp (unix seconds), svix-signature ("v1,<base64>" entries,
//            space separated; more than one during a secret rotation)
//   signed   `${svix-id}.${svix-timestamp}.${raw body}`, HMAC-SHA256, keyed with the base64 part
//            of RESEND_WEBHOOK_SECRET ("whsec_..."), from the webhook's page in the Resend dashboard.
// Off (404) unless RESEND_WEBHOOK_SECRET is set. A missing or wrong signature, or a timestamp
// more than 5 minutes from now (replay), is refused (401) and nothing is written. The signature
// covers the exact bytes Resend sent, so this router reads the raw body and app.js mounts it
// before the JSON parser.
//
// A bounce (type "email.bounced") flags every recipient in users.email_bounced: mail to them
// stops and admins see a warning until the address is corrected.
const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');

const TOLERANCE_SECONDS = 5 * 60;

function verifySvixSignature(headers, rawBody, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof secret !== 'string' || !secret) return false;
  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signatures = headers['svix-signature'];
  if (typeof id !== 'string' || typeof timestamp !== 'string' || typeof signatures !== 'string') return false;
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  if (key.length === 0) return false;
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.`).update(rawBody).digest();
  return signatures.split(' ').some((entry) => {
    const [version, signature] = entry.split(',');
    if (version !== 'v1' || !signature) return false;
    const given = Buffer.from(signature, 'base64');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

const router = express.Router();

router.post('/email-bounce', express.raw({ type: () => true, limit: '256kb' }), async (req, res, next) => {
  try {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return res.status(404).json({ error: 'not found' });
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifySvixSignature(req.headers, rawBody, secret)) return res.status(401).json({ error: 'invalid signature' });

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'body is not JSON' });
    }
    if (event?.type !== 'email.bounced') return res.json({ ok: true, flagged: 0 });
    const to = event.data?.to;
    const emails = (Array.isArray(to) ? to : [to]).filter((e) => typeof e === 'string' && e);
    let flagged = 0;
    for (const email of emails) {
      const r = await pool.query('UPDATE users SET email_bounced = true WHERE lower(email) = lower($1) AND NOT email_bounced', [email]);
      flagged += r.rowCount;
    }
    res.json({ ok: true, flagged });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
module.exports.verifySvixSignature = verifySvixSignature;
