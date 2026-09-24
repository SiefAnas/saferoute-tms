import { extractResetToken } from '@/lib/resetToken'

// The code from the "reset your password" email, pasted into the app as a link or on its own.
const TOKEN = 'a'.repeat(32) + '0123456789abcdef'.repeat(2)

describe('extractResetToken', () => {
  it('reads the token from the whole link', () => {
    expect(extractResetToken(`https://saferoute-tms-client.onrender.com/reset-password?token=${TOKEN}`)).toBe(TOKEN)
    expect(extractResetToken(`  saferoute://reset-password?x=1&token=${TOKEN.toUpperCase()}  `)).toBe(TOKEN)
  })
  it('accepts the bare code', () => {
    expect(extractResetToken(TOKEN)).toBe(TOKEN)
  })
  it('rejects anything else', () => {
    expect(extractResetToken('')).toBeNull()
    expect(extractResetToken(null)).toBeNull()
    expect(extractResetToken('https://example.test/reset-password')).toBeNull()
    expect(extractResetToken('hello world')).toBeNull()
    expect(extractResetToken('?token=xyz')).toBeNull()
  })
})
