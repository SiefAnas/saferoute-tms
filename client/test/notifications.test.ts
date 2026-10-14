// Plain Node test: where a clicked notification goes on the website, the bell's number, and the
// VAPID key conversion PushManager.subscribe needs.
import { badgeText, keyBytes, webRouteOf } from '../src/lib/notificationLogic.ts'

let pass = 0
let fail = 0
function eq(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`) }
}

console.log('--- webRouteOf ---')
eq('an in-site path', webRouteOf({ web_route: '/driver' }), '/driver')
eq('a URL is refused', webRouteOf({ web_route: 'https://evil.example' }), null)
eq('protocol-relative is refused', webRouteOf({ web_route: '//evil.example' }), null)
eq('the mobile route alone does not count', webRouteOf({ route: '/(driver)/today' } as never), null)
eq('no data', webRouteOf(null), null)

console.log('--- badgeText ---')
eq('zero: no badge', badgeText(0), null)
eq('a number', badgeText(7), '7')
eq('over 99', badgeText(150), '99+')

console.log('--- keyBytes ---')
const raw = Uint8Array.from({ length: 65 }, (_, i) => (i * 37) % 256)
const b64url = Buffer.from(raw).toString('base64url')
eq('base64url without padding round-trips', Array.from(keyBytes(b64url)), Array.from(raw))

console.log(`\n==== notifications: ${pass} passed, ${fail} failed ====`)
if (fail) process.exit(1)
