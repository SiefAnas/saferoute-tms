// Plain Node test: how a maintenance item's due state reads on the Fleet page.
import { dueLine, stateBadge } from '../src/pages/company/fleet/fleetText.ts'
import type { MaintenanceItem } from '../src/types/api.ts'

let pass = 0
let fail = 0
function eq(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`) }
}
const item = (over: Partial<MaintenanceItem>): MaintenanceItem => ({
  id: 'i', name: 'Oil change', builtin_key: 'oil_change', schedule_type: 'mileage', interval_days: null, interval_miles: 5000,
  due_date: null, due_miles: null, is_active: true, state: 'not_set', ...over,
})

console.log('--- dueLine ---')
eq('miles to go', dueLine(item({ state: 'due_soon', due_miles: 10000, miles_left: 400 })), `400 mi to go (at ${(10000).toLocaleString()} mi)`)
eq('miles over', dueLine(item({ state: 'overdue', due_miles: 10000, miles_left: -100 })), `100 mi over (due at ${(10000).toLocaleString()} mi)`)
eq('not set', dueLine(item({})), 'No mileage target set')
eq('off', dueLine(item({ state: 'off' })), 'Turned off')
eq('date overdue', dueLine(item({ schedule_type: 'date', state: 'overdue', days_left: -3, due_date: '2026-11-01' })).startsWith('3 days overdue'), true)
console.log('--- stateBadge ---')
eq('overdue', stateBadge(item({ state: 'overdue' }))?.tone, 'alert')
eq('due soon', stateBadge(item({ state: 'due_soon' }))?.tone, 'caution')
eq('no reading: no badge', stateBadge(item({ state: 'no_reading' })), null)

console.log(`\n==== fleet: ${pass} passed, ${fail} failed ====`)
if (fail) process.exit(1)
