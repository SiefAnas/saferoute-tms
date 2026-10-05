// Shared test-harness helpers: spin up an isolated embedded PostgreSQL per suite,
// run the real `migrate:up` CLI against it, and a tiny pass/fail recorder in the
// same style used throughout the Step 1-3 live verification.
const path = require('node:path');
const net = require('node:net');
const { rmSync, readFileSync, writeFileSync, existsSync } = require('node:fs');
const { execSync, execFileSync } = require('node:child_process');

const SERVER_DIR = path.resolve(__dirname, '..', '..'); // server/

function createRecorder(label) {
  let pass = 0;
  let fail = 0;
  const ok = (msg) => { pass++; console.log('  ✓', msg); };
  const bad = (msg) => { fail++; console.log('  ✗ FAIL:', msg); };
  const eq = (msg, got, want) =>
    (got === want ? ok(msg) : bad(`${msg} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`));
  const summarize = () => {
    console.log(`\n==== ${label}: ${pass} passed, ${fail} failed ====`);
    return { pass, fail };
  };
  return { ok, bad, eq, summarize };
}

// --- Embedded Postgres lifecycle -------------------------------------------------------------
//
// Why this is more than `new EmbeddedPostgres(...).start()`: on Windows, embedded-postgres stops
// the server with `taskkill /pid <postmaster> /f /t` (a force-kill of the process tree), does not
// wait for taskkill, and resolves as soon as the postmaster exits. Postgres 18 runs separate
// io_worker processes; when the tree kill takes a worker before the postmaster, the postmaster
// treats it as a crash and starts replacement workers that taskkill never saw. Those survive with
// no parent, keep the cluster's shared memory and port, and the next run of the same suite fails
// ("pre-existing shared memory block is still in use", or FATAL: undefined).
//
// So on Windows the suite stops the server the way Postgres expects: `pg_ctl stop -m fast`, which
// has the postmaster shut its own children down and exit last. A force kill is only the fallback,
// and it is awaited. As a second line of defence each run records its postmaster pid next to its
// data dir; the next run of the SAME suite clears exactly those processes (matched by pid AND this
// checkout's postgres binary AND, for the postmaster, this suite's data dir) before starting.
// Nothing belonging to another suite or another worktree can match.

const IS_WINDOWS = process.platform === 'win32';

function postgresProcesses() {
  // Win32_Process gives the parent pid and the full command line, which tasklist does not.
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress";
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }).trim();
  if (!out) return [];
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
}

const normalise = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

// Leftovers of a previous run of this suite, from the pid file it wrote at start. Returns the pids
// it stopped.
function clearOwnLeftovers(pidFile) {
  if (!existsSync(pidFile)) return [];
  let rec;
  try { rec = JSON.parse(readFileSync(pidFile, 'utf8')); } catch { rmSync(pidFile, { force: true }); return []; }
  const stopped = [];
  if (IS_WINDOWS && rec.pid && rec.binDir && rec.dataDir) {
    const bin = normalise(rec.binDir);
    const data = normalise(rec.dataDir);
    const ours = postgresProcesses().filter((p) => {
      const cmd = normalise(p.CommandLine);
      if (!cmd.includes(bin)) return false; // another checkout's binary: never ours
      if (p.ProcessId === rec.pid) return cmd.includes(data); // the old postmaster itself
      return p.ParentProcessId === rec.pid; // a child it left behind
    });
    for (const p of ours) {
      try { execFileSync('taskkill', ['/pid', String(p.ProcessId), '/f'], { stdio: 'ignore' }); stopped.push(p.ProcessId); } catch { /* already gone */ }
    }
  }
  rmSync(pidFile, { force: true });
  return stopped;
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}

async function stopCluster(epg, { dataDir, pidFile }) {
  const proc = epg.process;
  if (proc) {
    const exited = proc.exitCode !== null || proc.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => proc.once('exit', resolve));
    const waitExit = (ms) => Promise.race([exited.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);
    if (IS_WINDOWS) {
      const pgCtl = path.join(path.dirname(proc.spawnfile), 'pg_ctl.exe');
      try {
        execFileSync(pgCtl, ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '30'], { stdio: 'ignore' });
      } catch (err) {
        console.warn(`[testkit] pg_ctl stop failed (${err.message}); force-stopping the process tree`);
      }
      if (!(await waitExit(10000))) {
        try { execFileSync('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore' }); } catch { /* already gone */ }
        await waitExit(10000);
      }
    } else {
      proc.kill('SIGINT');
      if (!(await waitExit(15000))) { proc.kill('SIGKILL'); await waitExit(5000); }
    }
    epg.process = undefined;
  }
  // Remove the data dir here (the library's persistent:false cleanup only runs from its own stop).
  // A transient EBUSY right after exit on Windows is teardown noise, not a failure.
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (err) {
    console.warn(`[testkit] could not remove ${dataDir} (non-fatal): ${err.message}`);
  }
  rmSync(pidFile, { force: true });
}

async function startEmbeddedPostgres(name, port = 5432) {
  const EmbeddedPostgresPkg = require('embedded-postgres');
  const EmbeddedPostgres = EmbeddedPostgresPkg.default || EmbeddedPostgresPkg;
  const tmpDir = path.join(SERVER_DIR, 'test', '.tmp');
  const dataDir = path.join(tmpDir, name);
  const pidFile = path.join(tmpDir, `${name}.postmaster.json`);

  const cleared = clearOwnLeftovers(pidFile);
  if (cleared.length) console.warn(`[testkit] ${name}: stopped ${cleared.length} leftover postgres process(es) from its previous run: ${cleared.join(', ')}`);
  if (await portInUse(port)) {
    throw new Error(
      `[testkit] ${name}: port ${port} is already in use by something that is not a leftover of this suite ` +
      '(another suite, another worktree, or another program). Not touching it; free the port and re-run.'
    );
  }
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* first run: nothing to remove */ }

  const epg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'saferoute',
    password: 'saferoute',
    port,
    persistent: false,
  });
  await epg.initialise();
  try {
    await epg.start();
  } catch (err) {
    // The library rejects with no reason when postgres exits during startup.
    throw new Error(`[testkit] ${name}: embedded Postgres exited during startup on port ${port}${err ? `: ${err.message || err}` : ''} (its log is above)`);
  }
  writeFileSync(pidFile, JSON.stringify({ pid: epg.process.pid, binDir: path.dirname(epg.process.spawnfile), dataDir, port, startedAt: new Date().toISOString() }));
  await epg.createDatabase('saferoute_dev');

  // Replaces the library's stop for this instance (suites call epg.stop(); the library's own
  // exit hook calls it too). Never throws: teardown problems are logged, not test failures.
  epg.stop = async () => {
    try {
      await stopCluster(epg, { dataDir, pidFile });
    } catch (err) {
      console.warn(`[testkit] embedded-postgres stop warning (non-fatal): ${err.message}`);
    }
  };
  return epg;
}

function runMigrateUp({ silent = true } = {}) {
  execSync('npm run migrate:up', { cwd: SERVER_DIR, stdio: silent ? 'ignore' : 'inherit' });
}

// Accounts made through POST /users get a generated temporary password and must set their own
// before using the app (auth-accounts). Logs in with the temp password and sets `newPassword`,
// so a suite can then log in normally. Returns the change-password response body.
async function activateAccount(base, email, temporaryPassword, newPassword) {
  const post = (p, token, body) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const { token } = await post('/auth/login', null, { email, password: temporaryPassword });
  return post('/auth/change-password', token, { currentPassword: temporaryPassword, newPassword });
}

module.exports = { createRecorder, startEmbeddedPostgres, runMigrateUp, activateAccount, SERVER_DIR };
