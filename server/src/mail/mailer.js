// Pluggable transactional mailer.
//
// MVP uses a "dev" transport that records every message in memory (so tests can assert
// what would have been sent) and logs it. Swapping in real delivery later (e.g. nodemailer
// over SMTP, or a provider SDK) is a matter of adding a transport branch here — no caller
// changes. This is a NARROW capability for email-verification + claim notices only; the
// broad multi-channel notification system stays in v2 (spec §9).

const sentMessages = [];

async function sendMail({ to, subject, text }) {
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
