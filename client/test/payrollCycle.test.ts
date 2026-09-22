// Plain Node test, no framework (the client has none yet — see BACKLOG/OVERNIGHT_QUESTIONS
// for why). Run with: node client/test/payrollCycle.test.ts
// Mirrors the server suite's minimal ok/bad/eq style rather than introducing vitest/jest for
// one pure function.
import { isOnOrAfterCycleStart } from '../src/lib/payrollCycle.ts'

let pass = 0
let fail = 0
function eq(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

console.log('--- isOnOrAfterCycleStart ---')

eq('no paid_through_at (never paid) -> everything is in the current cycle', isOnOrAfterCycleStart('2020-01-01', null), true)

// The actual regression: an adjustment/session dated the SAME calendar day the cycle was
// closed, where paid_through_at is a real timestamp LATER that same day. The old buggy
// comparison (`work_date >= paidThroughAt.slice(0, 10)`, a date-string compare) would wrongly
// call this "in the new cycle" — it truncated away the time-of-day that makes it excluded.
eq(
  'same calendar day as paid_through_at, but BEFORE it in real time -> excluded (was the bug)',
  isOnOrAfterCycleStart('2026-09-22', '2026-09-22T15:00:00.000Z'),
  false,
)

eq(
  'same calendar day as paid_through_at, a full timestamp AFTER it -> included',
  isOnOrAfterCycleStart('2026-09-22T18:00:00.000Z', '2026-09-22T15:00:00.000Z'),
  true,
)

eq('a date clearly before paid_through_at -> excluded', isOnOrAfterCycleStart('2025-01-01', '2026-09-22T15:00:00.000Z'), false)
eq('a date clearly after paid_through_at -> included', isOnOrAfterCycleStart('2026-12-25', '2026-09-22T15:00:00.000Z'), true)

console.log(`\n==== payrollCycle: ${pass} passed, ${fail} failed ====`)
process.exit(fail === 0 ? 0 : 1)
