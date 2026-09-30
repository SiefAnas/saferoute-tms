// Owner tool: list, approve or reject placeholder claim requests (docs: overnight progress file,
// "How to approve a claim request"). Runs against DATABASE_URL from server/.env, i.e. whatever
// database the app points at. There is no approval screen yet on purpose.
//
//   node scripts/claim-requests.js list [--all]
//   node scripts/claim-requests.js approve <requestId> --by "Your name" [--note "called the school office"] --yes
//   node scripts/claim-requests.js reject  <requestId> --by "Your name" [--note "reason"] --yes
//
// Approve creates the requester's admin account with a temporary password (printed ONCE here),
// marks the organization claimed and closes its other requests. Only approve after confirming
// with the organization itself (e.g. calling the school's public office number).
require('dotenv').config();
const pool = require('../src/db/pool');
const { listClaimRequests, approveClaimRequest, rejectClaimRequest } = require('../src/services/claimRequests');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const [cmd, id] = process.argv.slice(2);
  const host = (() => {
    try { return new URL(process.env.DATABASE_URL).host; } catch { return '(DATABASE_URL not set)'; }
  })();
  console.log(`Database: ${host}`);

  if (cmd === 'list') {
    const rows = await listClaimRequests({ status: process.argv.includes('--all') ? null : 'pending' });
    if (!rows.length) console.log('No claim requests.');
    for (const r of rows) {
      console.log(`\n${r.id}  [${r.status}]  ${r.created_at.toISOString()}`);
      console.log(`  ${r.org_kind}: ${r.org_name ?? '(missing)'} — ${r.org_address ?? ''}  (${r.org_id})`);
      console.log(`  requester: ${r.requester_name} <${r.requester_email}>${r.requester_phone ? `  ${r.requester_phone}` : ''}  ip ${r.requester_ip ?? '?'}`);
      if (r.note) console.log(`  note: ${r.note}`);
      if (r.decided_at) console.log(`  decided ${r.decided_at.toISOString()} by ${r.decided_by}`);
    }
    return;
  }

  if (cmd !== 'approve' && cmd !== 'reject') {
    console.log('Usage: list [--all] | approve <requestId> --by "name" --yes | reject <requestId> --by "name" --yes');
    process.exitCode = 1;
    return;
  }
  if (!id) throw new Error('request id is required');
  const by = arg('--by');
  if (!by) throw new Error('--by "your name" is required');
  if (!process.argv.includes('--yes')) {
    console.log(`Dry run: add --yes to ${cmd} request ${id} on ${host}.`);
    process.exitCode = 1;
    return;
  }

  if (cmd === 'reject') {
    await rejectClaimRequest(id, { decidedBy: by, note: arg('--note') ?? null });
    console.log(`Rejected ${id}.`);
    return;
  }
  const { org, user, temporaryPassword } = await approveClaimRequest(id, { decidedBy: by, note: arg('--note') ?? null });
  console.log(`Approved. ${org.name} is now claimed.`);
  console.log(`Account: ${user.full_name} <${user.email}> (${user.role})`);
  console.log(`Temporary password (shown once, must be changed at first sign-in, expires in 7 days): ${temporaryPassword}`);
}

main()
  .catch((e) => {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
