// Shared input validation helpers (BACKLOG: no cross-cutting validation layer existed).
// Deliberately minimal — MVP-reasonable checks, not an exhaustive validation framework.
const { HttpError } = require('./errors');
const { US_STATE_CODES } = require('./usStates');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254; // RFC 5321 practical limit
const MIN_PASSWORD_LEN = 8; // matches the frontend's minLength=8
const ZIP_RE = /^\d{5}(-\d{4})?$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function assertValidEmail(email, field = 'email') {
  if (typeof email !== 'string' || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    throw new HttpError(400, `${field} must be a valid email address`);
  }
}

// Length + character-class complexity (registration rework): at least one uppercase,
// one lowercase, one non-alphanumeric character, matching the frontend's requirements text.
function assertPasswordStrength(password, field = 'password') {
  if (
    typeof password !== 'string' ||
    password.length < MIN_PASSWORD_LEN ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new HttpError(
      400,
      `${field} must be at least ${MIN_PASSWORD_LEN} characters and include an uppercase letter, a lowercase letter, and a special character`
    );
  }
}

function assertValidZip(zip, field = 'zip') {
  if (typeof zip !== 'string' || !ZIP_RE.test(zip)) {
    throw new HttpError(400, `${field} must be a valid US zip code`);
  }
}

// Returns the normalized (uppercased) code so callers can store the canonical form.
function assertValidState(state, field = 'state') {
  if (typeof state !== 'string' || !US_STATE_CODES.has(state.toUpperCase())) {
    throw new HttpError(400, `${field} must be a valid two-letter US state code`);
  }
  return state.toUpperCase();
}

// Only enforced when the value is present — required-ness is a separate check.
function assertMaxLength(value, max, field) {
  if (value !== undefined && value !== null && String(value).length > max) {
    throw new HttpError(400, `${field} must be ${max} characters or fewer`);
  }
}

// 24h "HH:MM" — used for assignments' pickup_time/dropoff_time and schedule overrides.
function assertValidTime(value, field = 'time') {
  if (typeof value !== 'string' || !TIME_RE.test(value)) {
    throw new HttpError(400, `${field} must be a valid 24-hour time in HH:MM format`);
  }
}

module.exports = {
  assertValidEmail,
  assertPasswordStrength,
  assertValidZip,
  assertValidState,
  assertValidTime,
  assertMaxLength,
};
