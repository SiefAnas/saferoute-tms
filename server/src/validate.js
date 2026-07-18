// Shared input validation helpers (BACKLOG: no cross-cutting validation layer existed).
// Deliberately minimal — MVP-reasonable checks, not an exhaustive validation framework.
const { HttpError } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254; // RFC 5321 practical limit
const MIN_PASSWORD_LEN = 8; // matches the frontend's existing minLength=8

function assertValidEmail(email, field = 'email') {
  if (typeof email !== 'string' || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    throw new HttpError(400, `${field} must be a valid email address`);
  }
}

function assertPasswordStrength(password, field = 'password') {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN) {
    throw new HttpError(400, `${field} must be at least ${MIN_PASSWORD_LEN} characters`);
  }
}

// Only enforced when the value is present — required-ness is a separate check.
function assertMaxLength(value, max, field) {
  if (value !== undefined && value !== null && String(value).length > max) {
    throw new HttpError(400, `${field} must be ${max} characters or fewer`);
  }
}

module.exports = { assertValidEmail, assertPasswordStrength, assertMaxLength };
