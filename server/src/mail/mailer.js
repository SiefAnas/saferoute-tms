// Pluggable transactional mailer.
//
// Dev transport (default): records every message in memory (so tests can assert what
// would have been sent) and logs it to the console. Real transport: nodemailer over SMTP,
// activated automatically when SMTP_HOST is set (e.g. Resend's SMTP endpoint) — used for
// live sending. NODE_ENV=test always uses the dev transport, regardless of SMTP config, so
// suites never depend on network access or real credentials. This is a NARROW capability
// for email-verification + claim notices only; the broad multi-channel notification system
// stays in v2 (spec §9).

const sentMessages = [];

let smtpTransport = null;
function getSmtpTransport() {
  if (!smtpTransport) {
    const nodemailer = require('nodemailer');
    smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return smtpTransport;
}

async function sendMail({ to, subject, text }) {
  const useSmtp = process.env.NODE_ENV !== 'test' && !!process.env.SMTP_HOST;

  if (useSmtp) {
    const info = await getSmtpTransport().sendMail({
      from: process.env.MAIL_FROM || 'SafeRoute TMS <onboarding@resend.dev>',
      to,
      subject,
      text,
    });
    return { to, subject, text, sentAt: new Date().toISOString(), messageId: info.messageId };
  }

  const message = { to, subject, text, sentAt: new Date().toISOString() };
  sentMessages.push(message);
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[mail] to=${to} | ${subject}\n${text}\n`);
  }
  return message;
}

// Test hooks
function _sent() {
  return sentMessages;
}
function _reset() {
  sentMessages.length = 0;
}

module.exports = { sendMail, _sent, _reset };
