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

let forcedFailure = null;

async function sendMail({ to, subject, text }) {
  if (forcedFailure) throw forcedFailure;
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

// Email is always a side effect of an action that is already saved, so a failed send must
// never fail the request. Returns true if sent, false if not. The log carries only the event
// type and the error (addresses redacted), never the recipient, subject or body.
async function sendMailSafe(message, event) {
  try {
    await sendMail(message);
    return true;
  } catch (err) {
    const code = err?.responseCode ?? err?.code ?? 'unknown';
    const detail = String(err?.message ?? err).replace(/[^\s<>"'@]+@[^\s<>"'@]+/g, '[email]');
    console.error(`[mail] send failed event=${event} code=${code} error=${detail}`);
    return false;
  }
}

// Test hooks
function _failWith(err) {
  forcedFailure = err ?? null;
}
function _sent() {
  return sentMessages;
}
function _reset() {
  sentMessages.length = 0;
}

module.exports = { sendMail, sendMailSafe, _sent, _reset, _failWith };
