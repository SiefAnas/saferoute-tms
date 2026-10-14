import { badgeText, notificationIdOf, permissionView, routeOf } from '@/features/notifications/logic'

describe('routeOf (where a tapped notification goes)', () => {
  it('takes an in-app path', () => {
    expect(routeOf({ route: '/(driver)/today' })).toBe('/(driver)/today')
  })
  it('refuses URLs, protocol-relative paths and junk', () => {
    expect(routeOf({ route: 'https://evil.example' })).toBeNull()
    expect(routeOf({ route: '//evil.example/x' })).toBeNull()
    expect(routeOf({ route: 42 })).toBeNull()
    expect(routeOf({})).toBeNull()
    expect(routeOf(null)).toBeNull()
  })
})

describe('notificationIdOf', () => {
  it('reads the id the server adds', () => {
    expect(notificationIdOf({ notification_id: 'abc' })).toBe('abc')
    expect(notificationIdOf({ notification_id: '' })).toBeNull()
    expect(notificationIdOf(undefined)).toBeNull()
  })
})

describe('permissionView (the Turn on card)', () => {
  it('simulators and web: no push', () => {
    expect(permissionView({ granted: true, canAskAgain: true }, false)).toBe('unsupported')
  })
  it('allowed: no card', () => {
    expect(permissionView({ granted: true, canAskAgain: true }, true)).toBe('on')
  })
  it('never asked, or Android lets us ask again: our explanation, then the prompt', () => {
    expect(permissionView({ granted: false, canAskAgain: true }, true)).toBe('ask')
    expect(permissionView(null, true)).toBe('ask')
  })
  it('a final no: only Settings can turn it on', () => {
    expect(permissionView({ granted: false, canAskAgain: false }, true)).toBe('settings')
  })
})

describe('badgeText', () => {
  it('nothing at zero, the number, then 99+', () => {
    expect(badgeText(0)).toBeNull()
    expect(badgeText(3)).toBe('3')
    expect(badgeText(120)).toBe('99+')
  })
})
