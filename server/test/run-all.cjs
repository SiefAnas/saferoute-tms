// Runs each *.test.cjs suite as its own process against its own isolated embedded
// PostgreSQL instance (sequential — same port, torn down between suites) and aggregates
// pass/fail across all of them. Filename prefixes (01-, 02-, ...) fix run order.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const testDir = __dirname;
const suites = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.cjs')).sort();

let anyFailed = false;
const results = [];

for (const file of suites) {
  console.log(`\n${'='.repeat(70)}\nRunning ${file}\n${'='.repeat(70)}`);
  const res = spawnSync(process.execPath, [path.join(testDir, file)], { stdio: 'inherit' });
  const passed = res.status === 0;
  if (!passed) anyFailed = true;
  results.push({ file, passed });
}

console.log(`\n${'='.repeat(70)}\nSUITE SUMMARY\n${'='.repeat(70)}`);
for (const r of results) {
  console.log(`  ${r.passed ? 'PASS' : 'FAIL'}  ${r.file}`);
}
process.exit(anyFailed ? 1 : 0);
