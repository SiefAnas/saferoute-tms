// Plain Node test, no framework (the client has none yet — see BACKLOG/OVERNIGHT_QUESTIONS
// for why). Run with: node client/test/payrollCycle.test.ts
// Mirrors the server suite's minimal ok/bad/eq style rather than introducing vitest/jest for
// one pure function.
import { isAdjustmentInCycle, isOnOrAfterCycleStart } from '../src/lib/payrollCycle.ts'

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

console.log('--- isOnOrAfterCycleStart (shifts: timestamp compare) ---')

eq('no paid_through_at (never paid) -> everything is in the current cycle', isOnOrAfterCycleStart('2020-01-01T08:00:00.000Z', null), true)

eq(
  'shift that started earlier the same day, before the Paid mark -> excluded (it was paid)',
  isOnOrAfterCycleStart('2026-09-22T12:00:00.000Z', '2026-09-22T15:00:00.000Z'),
  false,
)

eq(
  'same calendar day as paid_through_at, a full timestamp AFTER it -> included',
  isOnOrAfterCycleStart('2026-09-22T18:00:00.000Z', '2026-09-22T15:00:00.000Z'),
  true,
)

eq('a shift clearly before paid_through_at -> excluded', isOnOrAfterCycleStart('2025-01-01T08:00:00.000Z', '2026-09-22T15:00:00.000Z'), false)
eq('a shift clearly after paid_through_at -> included', isOnOrAfterCycleStart('2026-12-25T08:00:00.000Z', '2026-09-22T15:00:00.000Z'), true)

console.log('\n--- isAdjustmentInCycle (adjustments: calendar-date compare) ---')

// An adjustment dated the day the cycle was marked paid is in the NEW cycle: the server compares
// work_date >= the paid day as dates and counts it in the new owed total. An earlier version of
// this test expected it excluded, which made the drawer hide an amount the total included.
eq('never paid -> everything is in the cycle', isAdjustmentInCycle('2020-01-01', null), true)
eq('dated the paid day -> included', isAdjustmentInCycle('2026-09-22', '2026-09-22'), true)
eq('dated the paid day, as a DATE serialized at midnight UTC -> included', isAdjustmentInCycle('2026-09-22T00:00:00.000Z', '2026-09-22'), true)
eq('dated the day before -> excluded', isAdjustmentInCycle('2026-09-21', '2026-09-22'), false)
eq('dated after -> included', isAdjustmentInCycle('2026-09-23', '2026-09-22'), true)

console.log('\n--- listed adjustments add up to the owed total (same-day case) ---')

// Shaped like GET /payroll/unpaid-summary right after an adjustment dated the paid day was added
// (the server counts it: adjustments_cents 1234), plus the driver's full adjustment list. The
// server suite 11 checks the same thing against the real API.
const summary = { adjustments_cents: 1234, base_pay_cents: 0, total_pay_cents: 1234, paid_through_at: '2026-09-22T21:15:00.000Z', adjustments_from: '2026-09-22' }
const all = [
  { work_date: '2026-09-21', amount_cents: 500 }, // before the paid day: in the paid cycle
  { work_date: '2026-09-22', amount_cents: 1234 }, // the paid day itself: in the new cycle
]
const listed = all.filter((a) => isAdjustmentInCycle(a.work_date, summary.adjustments_from))
const listedSum = listed.reduce((n, a) => n + a.amount_cents, 0)
eq('the same-day adjustment is listed', listed.length, 1)
eq('listed adjustments sum to adjustments_cents', listedSum, summary.adjustments_cents)
eq('base + listed adjustments = total owed', summary.base_pay_cents + listedSum, summary.total_pay_cents)

console.log(`\n==== payrollCycle: ${pass} passed, ${fail} failed ====`)
process.exit(fail === 0 ? 0 : 1)
