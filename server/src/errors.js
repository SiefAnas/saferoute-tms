// Shared HTTP error type. Any thrown error with an integer `status` is mapped to that
// status by the app's central error handler; everything else becomes a 500.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// A referenced id that doesn't belong to the caller's tenant hits Postgres one of two ways:
// 23503 (foreign_key_violation) if it's a well-formed UUID that just isn't in scope, or
// 22P02 (invalid_text_representation) if it isn't even a valid UUID string to begin with —
// e.g. a garbage/foreign id typed or pasted into a client that doesn't validate first. Both
// mean the same thing to the caller ("that id doesn't exist here"), so both map to the same
// 400, rather than the 22P02 case falling through to an uncaught 500. Every route that
// inserts/updates against a client-supplied id should route its catch through this instead
// of hand-checking `err.code === '23503'` alone.
function mapMissingRefError(err, message) {
  if (err && (err.code === '23503' || err.code === '22P02')) return new HttpError(400, message);
  return err;
}

module.exports = { HttpError, mapMissingRefError };
