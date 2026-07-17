// Password hashing — bcryptjs (pure JS, no native build toolchain). Spec §4.
const bcrypt = require('bcryptjs');

const ROUNDS = 12;

async function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// A pre-computed hash used to run a compare even when the user doesn't exist,
// so login timing doesn't leak which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-never-matches', ROUNDS);

module.exports = { hashPassword, verifyPassword, DUMMY_HASH };
