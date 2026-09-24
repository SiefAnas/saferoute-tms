// Pluggable transactional mailer.
//
// Transports, picked in this order:
//   1. Resend HTTP API, when RESEND_API_KEY is set: one HTTPS request to api.resend.com (port
//      443). Works on hosts that block outgoing SMTP ports.
//   2. SMTP (nodemailer), when SMTP_HOST is set (e.g. smtp.resend.com).
//   3. Dev: records every message in memory (so tests can assert what would have been sent) and
//      logs it to the console.
// NODE_ENV=test always uses the dev transport, whatever is configured, so suites never depend
// on network access or real credentials (tests can force one with _useTransport).
//
// Every send has a hard time limit (MAIL_TIMEOUT_MS, default 15 s) on top of the transport's
// own timeouts, so a send can never hang. Emails are always a side effect of an action that is
// already saved: sendMailSafe / sendInBackground never throw and never hold up a request.

const sentMessages = [];

const MAIL_TIMEOUT_MS = () => Number(process.env.MAIL_TIMEOUT_MS) || 15_000;
const FROM = () => process.env.MAIL_FROM || 'SafeRoute TMS <onboarding@resend.dev>';

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
      // Fail fast instead of nodemailer's 2-minute defaults: a blocked or unreachable SMTP host
      // (seen live on Render, 2026-09-23) otherwise keeps each send hanging for minutes.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return smtpTransport;
}

// Test hooks: force a transport / a fetch implementation.
let forcedTransport = null;
let fetchImpl = (...args) => fetch(...args);

function activeTransport() {
  if (forcedTransport) return forcedTransport;
  if (process.env.NODE_ENV === 'test') return 'dev';
  if (process.env.RESEND_API_KEY) return 'resend-api';
  if (process.env.SMTP_HOST) return 'smtp';
  return 'dev';
}

// Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
function resendRequest({ to, subject, text }) {
  return {
    url: 'https://api.resend.com/emails',
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM(), to: [to], subject, text }),
    },
  };
}

async function sendViaResend(message, signal) {
  const { url, init } = resendRequest(message);
  const res = await fetchImpl(url, { ...init, signal });
  let body = null;
  try { body = await res.json(); } catch { /* no JSON body */ }
  if (!res.ok) {
    const err = new Error(`Resend API ${res.status}: ${body?.message ?? body?.name ?? 'request failed'}`);
    err.responseCode = res.status;
    throw err;
  }
  return body?.id ?? null;
}

let forcedFailure = null;
let forcedDelayMs = 0;

async function deliver(message, transport, signal) {
  if (forcedDelayMs) await new Promise((r) => setTimeout(r, forcedDelayMs));
  if (forcedFailure) throw forcedFailure;
  const { to, subject, text } = message;

  if (transport === 'resend-api') {
    const id = await sendViaResend(message, signal);
    return { to, subject, text, sentAt: new Date().toISOString(), messageId: id };
  }
  if (transport === 'smtp') {
    const info = await getSmtpTransport().sendMail({ from: FROM(), to, subject, text });
    return { to, subject, text, sentAt: new Date().toISOString(), messageId: info.messageId };
  }

  const sent = { to, subject, text, sentAt: new Date().toISOString() };
  sentMessages.push(sent);
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[mail] to=${to} | ${subject}\n${text}\n`);
  }
  return sent;
}

class MailTimeoutError extends Error {
  constructor(ms) {
    super(`no answer from the mail server after ${ms} ms`);
    this.name = 'MailTimeoutError';
    this.code = 'TIMEOUT';
  }
}

// Sends one email, or throws. Never takes longer than MAIL_TIMEOUT_MS: after that it gives up
// (and aborts the HTTP request, for the Resend API).
async function sendMail(message) {
  const transport = activeTransport();
  const ms = MAIL_TIMEOUT_MS();
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new MailTimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([deliver(message, transport, controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// A short, plain reason for the log, from the error nodemailer / fetch / the timeout gives.
function failureReason(err) {
  const code = String(err?.code ?? '');
  if (code === 'TIMEOUT' || code === 'ETIMEDOUT' || err?.name === 'AbortError') return 'timeout';
  if (code === 'EAUTH' || err?.responseCode === 401 || err?.responseCode === 535) return 'rejected-credentials';
  // Resend answers 403 for a wrong key and for "testing emails only to your own address" /
  // an unverified sending domain; its message (kept in the log) says which.
  if (err?.responseCode === 403) return 'refused';
  if (['ECONNECTION', 'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ESOCKET', 'EAI_AGAIN'].includes(code)) return 'connection';
  if (err?.responseCode >= 400) return 'rejected-by-server';
  return 'error';
}

const redact = (s) => String(s).replace(/[^\s<>"'@]+@[^\s<>"'@]+/g, '[email]');

// Email is always a side effect of an action that is already saved, so a failed send must
// never fail the request. Returns true if sent, false if not. The log carries the event type,
// the transport, how long it took and why it failed (addresses redacted), never the
// recipient, subject or body.
async function sendMailSafe(message, event) {
  const transport = activeTransport();
  const started = Date.now();
  try {
    await sendMail(message);
    if (process.env.NODE_ENV !== 'test' && transport !== 'dev') {
      console.log(`[mail] sent event=${event} via=${transport} ms=${Date.now() - started}`);
    }
    return true;
  } catch (err) {
    const reason = failureReason(err);
    const code = err?.responseCode ?? err?.code ?? 'unknown';
    const hint =
      transport === 'smtp' && (reason === 'timeout' || reason === 'connection')
        ? ' hint=outgoing SMTP may be blocked by the host; set RESEND_API_KEY to send over HTTPS instead'
        : '';
    console.error(
      `[mail] send failed event=${event} via=${transport} reason=${reason} code=${code} ms=${Date.now() - started} error=${redact(err?.message ?? err)}${hint}`
    );
    return false;
  }
}

// Sends that must never hold up a request (no-show, skip, schedule change, reset links...):
// started now, finished after the response. Failures are logged by sendMailSafe. Pending sends
// are tracked only so tests can wait for them (_drained).
const pending = new Set();
function sendInBackground(message, event) {
  const p = sendMailSafe(message, event).finally(() => pending.delete(p));
  pending.add(p);
}

// Test hooks
// Waits for every background send to finish, then returns what was "sent" (dev transport).
async function _drained() {
  while (pending.size) await Promise.allSettled([...pending]);
  return sentMessages;
}
function _failWith(err) {
  forcedFailure = err ?? null;
}
// Makes every send take `ms` (a slow or blocked mail server).
function _slowBy(ms) {
  forcedDelayMs = ms;
}
// Forces a transport ('dev' | 'smtp' | 'resend-api') and, optionally, the fetch it uses.
function _useTransport(name, fetchFn) {
  forcedTransport = name ?? null;
  fetchImpl = fetchFn ?? ((...args) => fetch(...args));
}
function _sent() {
  return sentMessages;
}
function _reset() {
  sentMessages.length = 0;
}

module.exports = {
  sendMail, sendMailSafe, sendInBackground, resendRequest,
  _sent, _drained, _reset, _failWith, _slowBy, _useTransport,
};
