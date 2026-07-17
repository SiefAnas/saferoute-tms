// JWT sign/verify. Claims are minimal: identity + a hint of role/tenant.
// The authenticate middleware re-derives role/tenant from the DB (authoritative),
// so a stale token can never widen access.
const jwt = require('jsonwebtoken');
const { jwtSecret, jwtExpiresIn } = require('../config');

function signJwt(payload) {
  return jwt.sign(payload, jwtSecret, { expiresIn: jwtExpiresIn });
}

function verifyJwt(token) {
  return jwt.verify(token, jwtSecret);
}

module.exports = { signJwt, verifyJwt };
