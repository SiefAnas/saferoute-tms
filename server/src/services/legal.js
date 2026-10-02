// Terms of Use / Privacy Policy acceptance at signup (branch account-settings). The documents
// live in client/src/legal/{terms,privacy}.md; each starts with a frontmatter block carrying its
// `version` and `effective` date. The signup form sends the versions the person was shown, and
// one legal_acceptances row per document is written in the same transaction as the account.
//
// The server reads the same files so it can refuse an outdated version (the page was open while
// the documents changed). If the files aren't part of the server's deployment, it can't check:
// it then records the submitted versions as given and logs that once.
const fs = require('fs');
const path = require('path');
const { HttpError } = require('../errors');

const DOCUMENTS = ['terms', 'privacy'];
const LEGAL_DIR = process.env.LEGAL_DIR || path.resolve(__dirname, '..', '..', '..', 'client', 'src', 'legal');
const VERSION_RE = /^[A-Za-z0-9._-]{1,40}$/;

// "---\nversion: 1.0\neffective: 2026-10-02\n---\n..." -> { version: '1.0', effective: '2026-10-02' }
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*(.*?)\s*$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

let cached;
let warned = false;
function currentVersions() {
  if (cached !== undefined) return cached;
  try {
    cached = Object.fromEntries(DOCUMENTS.map((d) => [d, parseFrontmatter(fs.readFileSync(path.join(LEGAL_DIR, `${d}.md`), 'utf8')).version]));
    if (DOCUMENTS.some((d) => !cached[d])) throw new Error('missing version in frontmatter');
  } catch (err) {
    cached = null;
    if (!warned) {
      warned = true;
      console.warn(`[legal] cannot read document versions from ${LEGAL_DIR} (${err.message}); recording the versions the signup form sends without checking them`);
    }
  }
  return cached;
}

// body.acceptLegal = { terms: '<version>', privacy: '<version>' } (the checkbox). Returns the
// versions to record, or throws 400 (not accepted) / 409 (accepted an outdated version).
function assertLegalAccepted(acceptLegal) {
  if (!acceptLegal || typeof acceptLegal !== 'object' || DOCUMENTS.some((d) => typeof acceptLegal[d] !== 'string' || !acceptLegal[d])) {
    throw new HttpError(400, 'you must agree to the Terms of Use and the Privacy Policy');
  }
  const current = currentVersions();
  for (const d of DOCUMENTS) {
    if (!VERSION_RE.test(acceptLegal[d])) throw new HttpError(400, 'you must agree to the Terms of Use and the Privacy Policy');
    if (current && acceptLegal[d] !== current[d]) {
      throw new HttpError(409, 'The Terms of Use or Privacy Policy changed while this page was open. Reload the page and agree again.');
    }
  }
  return Object.fromEntries(DOCUMENTS.map((d) => [d, acceptLegal[d]]));
}

async function recordAcceptances(client, userId, versions, ip) {
  for (const d of DOCUMENTS) {
    await client.query('INSERT INTO legal_acceptances (user_id, document, version, ip) VALUES ($1, $2, $3, $4)', [userId, d, versions[d], ip ?? null]);
  }
}

module.exports = { DOCUMENTS, parseFrontmatter, currentVersions, assertLegalAccepted, recordAcceptances };
