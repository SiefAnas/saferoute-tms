// Verification tokens: a random raw token is emailed to the user; only its SHA-256 hash
// is stored, so a leaked DB can't be used to verify accounts.
const crypto = require('crypto');

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashToken(raw) };
}

module.exports = { generateToken, hashToken };
