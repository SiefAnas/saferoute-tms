// Shared HTTP error type. Any thrown error with an integer `status` is mapped to that
// status by the app's central error handler; everything else becomes a 500.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { HttpError };
