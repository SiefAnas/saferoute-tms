import { SIGNIN_CHOICES, signinSummary } from '@/features/admin/signinReminderText'

describe('signinSummary (driver sign-in reminder line)', () => {
  it('company default and own timing', () => {
    expect(signinSummary({ mode: 'default', effective_minutes: 30 })).toBe('Company default: 30 minutes before the first stop of each run.')
    expect(signinSummary({ mode: 'custom', effective_minutes: 45 })).toBe('Own timing: 45 minutes before the first stop of each run.')
  })
  it('off for the driver, or off for the company', () => {
    expect(signinSummary({ mode: 'off', effective_minutes: null })).toBe('Off for this driver.')
    expect(signinSummary({ mode: 'default', effective_minutes: null })).toBe('No sign-in reminder.')
  })
  it('the choices include 30 and 40 minutes', () => {
    expect(SIGNIN_CHOICES).toEqual(expect.arrayContaining([30, 40]))
  })
})
