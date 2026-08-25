// Safety pass ahead of real company data going live (3 Bees Transportation): config.js
// must refuse to boot in production with insecure defaults, and must stay unchanged in
// dev/test; mailer.js must never attempt a real SMTP send under NODE_ENV=test even when
// SMTP_HOST is configured. No DB needed — these are process-boundary checks.
const { spawnSync } = require('node:child_process');
const { createRecorder, SERVER_DIR } = require('./lib/testkit.cjs');

const rec = createRecorder('08-boot-safety');
const { ok, bad } = rec;

function runConfig(env) {
  return spawnSync(process.execPath, ['-e', "require('./src/config')"], {
    cwd: SERVER_DIR,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

async function main() {
  {
    const res = runConfig({ NODE_ENV: 'production', JWT_SECRET: '', DATABASE_URL: '' });
    res.status !== 0
      ? ok('production boot fails when both JWT_SECRET and DATABASE_URL are missing')
      : bad('production boot did not fail with both secrets missing');
    /JWT_SECRET/.test(res.stderr) && /DATABASE_URL/.test(res.stderr)
      ? ok('production error message names both missing vars')
      : bad(`production error message unclear: ${res.stderr}`);
  }

  {
    const res = runConfig({ NODE_ENV: 'production', JWT_SECRET: '', DATABASE_URL: 'postgres://x' });
    res.status !== 0
      ? ok('production boot fails when only JWT_SECRET is missing')
      : bad('production boot did not fail with only JWT_SECRET missing');
  }

  {
    const res = runConfig({ NODE_ENV: 'production', JWT_SECRET: 'real-secret', DATABASE_URL: 'postgres://x' });
    res.status === 0
      ? ok('production boots fine once both secrets are set')
      : bad(`production boot failed unexpectedly: ${res.stderr}`);
  }

  {
    const res = runConfig({ NODE_ENV: 'development', JWT_SECRET: '', DATABASE_URL: '' });
    res.status === 0
      ? ok('development boot unaffected by missing secrets (unchanged dev behavior)')
      : bad(`development boot broke: ${res.stderr}`);
  }

  {
    const res = runConfig({ NODE_ENV: 'test', JWT_SECRET: '', DATABASE_URL: '' });
    res.status === 0
      ? ok('test-env boot unaffected by missing secrets (unchanged test behavior)')
      : bad(`test-env boot broke: ${res.stderr}`);
  }

  {
    const script = `
      process.env.NODE_ENV = 'test';
      process.env.SMTP_HOST = 'smtp.resend.com';
      process.env.DATABASE_URL = 'postgres://x';
      process.env.JWT_SECRET = 'x';
      const m = require('./src/mail/mailer.js');
      m.sendMail({ to: 'a@b.com', subject: 's', text: 't' })
        .then(() => { console.log('SENT', m._sent().length); process.exit(0); })
        .catch((e) => { console.error('FATAL', e); process.exit(1); });
    `;
    const res = spawnSync(process.execPath, ['-e', script], { cwd: SERVER_DIR, encoding: 'utf8', timeout: 5000 });
    res.status === 0 && /SENT 1/.test(res.stdout)
      ? ok('mailer stays on the dev transport under NODE_ENV=test even with SMTP_HOST set (no real network attempt)')
      : bad(`mailer test-mode override failed: status=${res.status} stdout=${res.stdout} stderr=${res.stderr}`);
  }

  const { fail } = rec.summarize();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
