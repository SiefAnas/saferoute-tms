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

  it.each(['company_admin', 'school_admin', 'school_staff'] as const)(
    'sends %s to the website explanation screen',
    (role) => {
      expect(destinationForRole(role)).toBe('/unsupported')
    },
  )

  it('sends an unknown or missing role to the explanation screen, not into an app', () => {
    expect(destinationForRole(null)).toBe('/unsupported')
    expect(destinationForRole(undefined)).toBe('/unsupported')
    // A role the API adds later must not fall through into the driver app.
    expect(destinationForRole('dispatcher' as never)).toBe('/unsupported')
  })
})

describe('isMobileRole', () => {
  it('is true only for driver and parent', () => {
    expect(isMobileRole('driver')).toBe(true)
    expect(isMobileRole('parent')).toBe(true)
    expect(isMobileRole('company_admin')).toBe(false)
    expect(isMobileRole(null)).toBe(false)
  })
})
