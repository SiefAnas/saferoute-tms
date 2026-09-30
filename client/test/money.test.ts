// Plain Node test, same style as the others: reading dollar amounts from spreadsheet cells for
// the payroll rate import (currency text, decimal comma, and refusing anything ambiguous).
import { parseDollarAmount } from '../src/lib/money.ts'

let pass = 0
let fail = 0
function eq(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`) }
}
const cents = (s: string) => {
  const r = parseDollarAmount(s)
  return r.ok ? r.cents : `error: ${r.reason}`
}
const refused = (s: string) => !parseDollarAmount(s).ok

console.log('--- accepted ---')
eq('plain', cents('12.50'), 1250)
eq('whole dollars', cents('12'), 1200)
eq('one decimal', cents('12.5'), 1250)
eq('dollar sign (an Excel currency cell)', cents('$12.50'), 1250)
eq('dollar sign with a space', cents('$ 12.50'), 1250)
eq('trailing dollar sign', cents('12.50 $'), 1250)
eq('USD', cents('12.50 USD'), 1250)
eq('decimal comma', cents('12,50'), 1250)
eq('decimal comma, one digit', cents('12,5'), 1250)
eq('thousands comma + decimal point', cents('$1,234.50'), 123450)
eq('thousands point + decimal comma', cents('1.234,50'), 123450)
eq('several thousands groups, no decimals', cents('1,234,567'), 123456700)
eq('leading decimal point', cents('.50'), 50)
eq('zero', cents('$0.00'), 0)
eq('surrounding spaces', cents('  22.00  '), 2200)

console.log('--- refused (ambiguous or not an amount) ---')
eq('"1,234" could be 1234 or 1.234', refused('1,234'), true)
eq('"1.234" could be 1.234 or 1234', refused('1.234'), true)
eq('the message explains both readings', (parseDollarAmount('1,234') as { reason: string }).reason.includes('1234 or 1.234'), true)
eq('more than 2 decimals', refused('12.505'), true)
eq('negative', refused('-12.50'), true)
eq('negative in parentheses', refused('($12.50)'), true)
eq('empty', refused('   '), true)
eq('words', refused('twelve'), true)
eq('another currency', refused('€12.50'), true)
eq('bad grouping', refused('12,34.50'), true)
eq('two decimal marks', refused('1.234.5,6,7'), true)
eq('letters mixed in', refused('12.50/hr'), true)
eq('only a separator', refused('$.'), true)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
