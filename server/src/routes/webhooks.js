// Mail provider callbacks. A bounce flags the user (email_bounced) so mail to that address stops
// and the admin sees a warning. Off unless BOUNCE_WEBHOOK_SECRET is set; the provider must send
// it in the x-webhook-secret header. Accepts Resend's shape ({type:'email.bounced', data:{to:[..]}})
// or a plain {email}.
const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

function secretMatches(given) {
  const want = process.env.BOUNCE_WEBHOOK_SECRET;
  if (!want || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/email-bounce', async (req, res, next) => {
  try {
    if (!secretMatches(req.headers['x-webhook-secret'])) return res.status(404).json({ error: 'not found' });
    const body = req.body || {};
    if (body.type && body.type !== 'email.bounced') return res.json({ ok: true, flagged: 0 });
    const emails = [body.email, ...(Array.isArray(body.data?.to) ? body.data.to : [body.data?.to])].filter((e) => typeof e === 'string' && e);
    let flagged = 0;
    for (const email of emails) {
      const r = await pool.query('UPDATE users SET email_bounced = true WHERE lower(email) = lower($1) AND NOT email_bounced', [email]);
      flagged += r.rowCount;
    }
    res.json({ ok: true, flagged });
  } catch (e) { next(e); }
});

module.exports = router;
