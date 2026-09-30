import fs from 'fs'
import path from 'path'
import { sessionEndedMessage } from '@/auth/sessionMessages'
import { accountStatusText } from '@/features/admin/logic'

describe('sessionEndedMessage', () => {
  it('says the temporary password expired and who can fix it', () => {
    expect(sessionEndedMessage({ code: 'TEMP_PASSWORD_EXPIRED' })).toMatch(/temporary password has expired.*admin/i)
  })
  it('says the account is no longer active when it was deactivated', () => {
    expect(sessionEndedMessage({ code: 'ACCOUNT_INACTIVE' })).toMatch(/no longer active/i)
  })
  it('says the password was changed or reset', () => {
    expect(sessionEndedMessage({ code: 'PASSWORD_CHANGED' })).toMatch(/password was changed or reset/i)
  })
  it('falls back to a plain session-ended message', () => {
    expect(sessionEndedMessage({ message: 'invalid or expired token' })).toBe('Your session has ended. Please sign in again.')
    expect(sessionEndedMessage(undefined)).toBe('Your session has ended. Please sign in again.')
  })
})

describe('accountStatusText', () => {
  const base = { is_active: true, must_change_password: false, account_status: 'active' as const, temp_password_expires_at: null }
  const date = () => 'Oct 7'
  it('active', () => expect(accountStatusText(base, date)).toBe('Active'))
  it('created, with the date the temporary password stops working', () => {
    expect(accountStatusText({ ...base, must_change_password: true, account_status: 'created', temp_password_expires_at: '2026-10-07T12:00:00Z' }, date))
      .toBe('Created. Temporary password not changed yet (works until Oct 7).')
  })
  it('never logged in (temporary password expired unused)', () => {
    expect(accountStatusText({ ...base, must_change_password: true, account_status: 'never_logged_in' }, date)).toMatch(/^Never logged in/)
  })
  it('deactivated wins over everything', () => {
    expect(accountStatusText({ ...base, is_active: false, account_status: 'created' }, date)).toBe('Deactivated')
  })
  it('an API without account_status falls back to the temporary-password flag', () => {
    expect(accountStatusText({ is_active: true, must_change_password: true, account_status: undefined, temp_password_expires_at: undefined }, date))
      .toBe('Created. Temporary password not changed yet.')
    expect(accountStatusText({ is_active: true, must_change_password: false, account_status: undefined, temp_password_expires_at: undefined }, date)).toBe('Active')
  })
})

// Bulk import is website-only (docs/bulk-import-spec.md). This fails if it ever shows up in the app.
describe('import stays off mobile', () => {
  const root = path.join(__dirname, '..')
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(tsx?|jsx?)$/.test(e.name)) files.push(p)
    }
  }
  walk(path.join(root, 'app'))
  walk(path.join(root, 'src'))
  it('no screen or module calls the import API or offers an import', () => {
    const hits = files.filter((f) => /\/imports\b|bulk import|xlsx|Import students|Import drivers/i.test(fs.readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
})
