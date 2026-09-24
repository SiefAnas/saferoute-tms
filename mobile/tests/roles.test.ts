import { destinationForRole, isMobileRole } from '@/lib/roles'

// Where each role lands after signing in. Only two roles have an app; everyone else must be
// sent to the explanation screen rather than into a driver or parent shell they cannot use.
describe('destinationForRole', () => {
  it('sends a driver to the driver app', () => {
    expect(destinationForRole('driver')).toBe('/(driver)/today')
  })

  it('sends a parent to the parent app', () => {
    expect(destinationForRole('parent')).toBe('/(parent)/students')
  })

  it('sends a monitor to the monitor app', () => {
    expect(destinationForRole('monitor')).toBe('/(monitor)/home')
  })

  it('sends a company admin to the company app', () => {
    expect(destinationForRole('company_admin')).toBe('/(company)/home')
  })

  it.each(['school_admin', 'school_staff'] as const)('sends %s to the school app', (role) => {
    expect(destinationForRole(role)).toBe('/(school)/pickup')
  })

  it('sends an unknown or missing role to the explanation screen, not into an app', () => {
    expect(destinationForRole(null)).toBe('/unsupported')
    expect(destinationForRole(undefined)).toBe('/unsupported')
    // A role the API adds later must not fall through into the driver app.
    expect(destinationForRole('dispatcher' as never)).toBe('/unsupported')
  })
})

describe('isMobileRole', () => {
  it('is true for every known role, false for none or an unknown one', () => {
    for (const r of ['driver', 'parent', 'monitor', 'company_admin', 'school_admin', 'school_staff'] as const) {
      expect(isMobileRole(r)).toBe(true)
    }
    expect(isMobileRole(null)).toBe(false)
    expect(isMobileRole('dispatcher' as never)).toBe(false)
  })
})

describe('monitor Today helpers', () => {
  // Pure helpers from the monitor app (no React Native), so jest can run them.
  const { defaultMonitorShift, ridesToday } = jest.requireActual('@/features/monitor/helpers') as typeof import('@/features/monitor/helpers')
  const base = {
    monitor: { id: 'm', full_name: 'Mia' },
    driver: null,
    van: null,
    open_session: null,
    today_sessions: [],
  }
  it('opens on the shift they are checked into, else the only shift they ride', () => {
    const morningOnly = { ...base, assignment: { days_of_week: [1, 2, 3], shift_period: 'afternoon' as const } }
    expect(defaultMonitorShift(morningOnly, new Date(2026, 8, 21, 8))).toBe('afternoon')
    const open = { ...morningOnly, open_session: { id: 's', shift_period: 'morning' as const, check_in_at: '2026-09-21T12:00:00Z' } }
    expect(defaultMonitorShift(open, new Date(2026, 8, 21, 15))).toBe('morning')
    const both = { ...base, assignment: { days_of_week: [1], shift_period: 'both' as const } }
    expect(defaultMonitorShift(both, new Date(2026, 8, 21, 8))).toBe('morning')
    expect(defaultMonitorShift(both, new Date(2026, 8, 21, 15))).toBe('afternoon')
  })
  it('rides today only on an assigned weekday (ISO, Sunday = 7)', () => {
    const monWed = { ...base, assignment: { days_of_week: [1, 3], shift_period: 'both' as const } }
    expect(ridesToday(monWed, new Date(2026, 8, 21))).toBe(true) // Monday
    expect(ridesToday(monWed, new Date(2026, 8, 22))).toBe(false) // Tuesday
    const sunday = { ...base, assignment: { days_of_week: [7], shift_period: 'both' as const } }
    expect(ridesToday(sunday, new Date(2026, 8, 27))).toBe(true)
    expect(ridesToday({ ...base, assignment: null }, new Date(2026, 8, 21))).toBe(false)
  })
})
