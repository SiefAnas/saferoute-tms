// Terms of Use and Privacy Policy (branch account-settings). The documents live with the API in
// server/src/legal/{terms,privacy}.md; each starts with a frontmatter block carrying its
// `version` and `effective` date. GET /legal/:document serves them (the website renders the
// markdown), and signup records one legal_acceptances row per document for the version the person
// agreed to, which must be the current one.
//
// The files ship with the server code, so not finding them is a broken deployment: src/index.js
// calls loadLegalDocuments() before listening and refuses to start if it throws. There is no
// fallback that accepts whatever version a client sends.
const fs = require('fs');
const path = require('path');
const { HttpError } = require('../errors');

const DOCUMENTS = ['terms', 'privacy'];
const LEGAL_DIR = process.env.LEGAL_DIR || path.resolve(__dirname, '..', 'legal');
const VERSION_RE = /^[A-Za-z0-9._-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// "---\nversion: 1.0\neffective: 2026-10-02\n---\n..." -> { meta: { version, effective }, body }
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*(.*?)\s*$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function readDocument(document) {
  const file = path.join(LEGAL_DIR, `${document}.md`);
  const text = fs.readFileSync(file, 'utf8');
  const meta = parseFrontmatter(text);
  if (!VERSION_RE.test(meta.version ?? '')) throw new Error(`${file}: frontmatter needs a "version" (letters, digits, . _ -)`);
  if (!DATE_RE.test(meta.effective ?? '')) throw new Error(`${file}: frontmatter needs an "effective" date (YYYY-MM-DD)`);
  // The website parses the frontmatter itself too, so the whole file is sent as `markdown`.
  return { document, version: meta.version, effective: meta.effective, markdown: text };
}

let loaded = null;

// Reads and checks both files once. Throws with the file and the reason; the caller decides how
// loud to be (index.js: log and exit).
function loadLegalDocuments() {
  if (!loaded) loaded = Object.fromEntries(DOCUMENTS.map((d) => [d, readDocument(d)]));
  return loaded;
}

// GET /legal/:document. Unknown names are 404, like any unknown route.
function getLegalDocument(document) {
  if (!DOCUMENTS.includes(document)) throw new HttpError(404, 'not found');
  return loadLegalDocuments()[document];
}

function currentVersions() {
  const docs = loadLegalDocuments();
  return Object.fromEntries(DOCUMENTS.map((d) => [d, docs[d].version]));
}

// body.acceptLegal = { terms: '<version>', privacy: '<version>' } (the checkbox). Returns the
// versions to record, or throws 400 (not accepted) / 409 (accepted an outdated version).
function assertLegalAccepted(acceptLegal) {
  if (!acceptLegal || typeof acceptLegal !== 'object' || DOCUMENTS.some((d) => typeof acceptLegal[d] !== 'string' || !acceptLegal[d])) {
    throw new HttpError(400, 'you must agree to the Terms of Use and the Privacy Policy');
  }
  const current = currentVersions();
  for (const d of DOCUMENTS) {
    if (acceptLegal[d] !== current[d]) {
      throw new HttpError(409, 'The Terms of Use or Privacy Policy changed while this page was open. Reload the page and agree again.');
    }
  }
  return current;
}

async function recordAcceptances(client, userId, versions, ip) {
  for (const d of DOCUMENTS) {
    await client.query('INSERT INTO legal_acceptances (user_id, document, version, ip) VALUES ($1, $2, $3, $4)', [userId, d, versions[d], ip ?? null]);
  }
}

// SQL for "this user has not yet accepted the current version of every document", for a user
// row aliased `alias`. Versions come from the server's own copy (currentVersions), as bind
// parameters starting at $<firstParam>, in DOCUMENTS order. Used by authenticate (the gate) and
// by login/change-password (legal_pending in the session payload).
function legalPendingSql(alias, firstParam) {
  const pairs = DOCUMENTS.map((d, i) => `(la.document = '${d}' AND la.version = $${firstParam + i})`).join(' OR ');
  return `(SELECT count(DISTINCT la.document) FROM legal_acceptances la WHERE la.user_id = ${alias}.id AND (${pairs})) < ${DOCUMENTS.length}`;
}
function legalPendingParams() {
  const current = currentVersions();
  return DOCUMENTS.map((d) => current[d]);
}

async function isLegalPending(db, userId) {
  const { rows } = await db.query(`SELECT ${legalPendingSql('u', 2)} AS pending FROM users u WHERE u.id = $1`, [userId, ...legalPendingParams()]);
  return Boolean(rows[0]?.pending);
}

// Gate switch. Always on, except LEGAL_GATE=off, which only the test kit sets (test/lib/
// testkit.cjs): the suites' fixtures sign users in directly without an acceptance row. The
// suite that tests the gate (55-legal-gate) sets LEGAL_GATE=on before loading the kit.
function legalGateEnabled() {
  return process.env.LEGAL_GATE !== 'off';
}

// POST /legal/accept: a signed-in user agrees to the current Terms and Privacy Policy (the
// first-sign-in screen, or after a new version is published). body = { terms, privacy }, the
// versions the screen showed; an outdated version is a 409 like at signup. Records only what is
// missing, so a double tap doesn't write duplicate rows.
async function acceptCurrentLegal(db, userId, body, ip) {
  const versions = assertLegalAccepted(body);
  const { rows } = await db.query('SELECT document, version FROM legal_acceptances WHERE user_id = $1', [userId]);
  for (const d of DOCUMENTS) {
    if (rows.some((r) => r.document === d && r.version === versions[d])) continue;
    await db.query('INSERT INTO legal_acceptances (user_id, document, version, ip) VALUES ($1, $2, $3, $4)', [userId, d, versions[d], ip ?? null]);
  }
  return { ok: true, legal_pending: false, versions };
}

module.exports = {
  DOCUMENTS,
  LEGAL_DIR,
  parseFrontmatter,
  loadLegalDocuments,
  getLegalDocument,
  currentVersions,
  assertLegalAccepted,
  recordAcceptances,
  legalPendingSql,
  legalPendingParams,
  isLegalPending,
  legalGateEnabled,
  acceptCurrentLegal,
};
