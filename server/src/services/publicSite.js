// Public website forms (routes/publicSite.js). No login.
//  - Contact us: emailed only, nothing stored. Business questions go to the admin inbox, technical
//    support to the support inbox. The send is awaited, so the sender is told if it didn't go out.
//  - Book a demo (Companies / Schools pages): saved in demo_requests, then emailed to the admin
//    inbox in the background (the request is already saved, so a failed send loses nothing).
const pool = require('../db/pool');
const { HttpError } = require('../errors');
const { assertValidEmail, assertMaxLength } = require('../validate');
const { sendMailSafe, sendInBackground } = require('../mail/mailer');

const ADMIN_INBOX = 'admin@safeturns.com';
const SUPPORT_INBOX = 'support@safeturns.com';

const CONTACT_TOPICS = {
  business: { to: ADMIN_INBOX, label: 'Business question' },
  support: { to: SUPPORT_INBOX, label: 'Technical support' },
};
const DEMO_AUDIENCES = {
  company: { label: 'Company', page: 'Companies' },
  school: { label: 'School', page: 'Schools' },
};

// Trimmed string, or null when blank. Throws when required and blank, or too long.
function text(body, field, { required = false, max = 200 } = {}) {
  const raw = body[field];
  if (raw !== undefined && raw !== null && typeof raw !== 'string') throw new HttpError(400, `${field} must be text`);
  const value = (raw ?? '').trim();
  if (required && !value) throw new HttpError(400, `${field} is required`);
  assertMaxLength(value, max, field);
  return value || null;
}

// One line in the email per field the sender filled in.
function lines(pairs) {
  return pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
}

async function sendContactMessage(body) {
  const topic = CONTACT_TOPICS[body.topic];
  if (!topic) throw new HttpError(400, 'topic must be business or support');
  const fullName = text(body, 'full_name', { required: true });
  const email = text(body, 'email', { required: true, max: 254 });
  assertValidEmail(email);
  const phone = text(body, 'phone', { max: 40 });
  const message = text(body, 'message', { required: true, max: 5000 });

  const sent = await sendMailSafe(
    {
      to: topic.to,
      subject: `${topic.label} from ${fullName}`,
      text: `${lines([['Topic', topic.label], ['Name', fullName], ['Email', email], ['Phone', phone]])}\n\n${message}\n`,
    },
    `contact-${body.topic}`
  );
  if (!sent) throw new HttpError(502, 'Your message could not be sent. Please try again later.');
  return { sent: true };
}

async function createDemoRequest(body) {
  const audience = body.audience;
  if (!DEMO_AUDIENCES[audience]) throw new HttpError(400, 'audience must be company or school');
  const fullName = text(body, 'full_name', { required: true });
  const email = text(body, 'email', { required: true, max: 254 });
  assertValidEmail(email);
  const phone = text(body, 'phone', { max: 40 });
  const organization = text(body, 'organization', { required: true });
  const message = text(body, 'message', { max: 5000 });

  const { rows } = await pool.query(
    `INSERT INTO demo_requests (audience, full_name, email, phone, organization, message)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
    [audience, fullName, email, phone, organization, message]
  );

  const { label, page } = DEMO_AUDIENCES[audience];
  sendInBackground(
    {
      to: ADMIN_INBOX,
      subject: `Demo request (${label}): ${organization}`,
      text: `${lines([['From page', page], [label, organization], ['Name', fullName], ['Email', email], ['Phone', phone]])}${message ? `\n\n${message}` : ''}\n`,
    },
    'demo-request'
  );
  return { id: rows[0].id, created_at: rows[0].created_at };
}

module.exports = { sendContactMessage, createDemoRequest, ADMIN_INBOX, SUPPORT_INBOX };
