import fs from 'fs'
import path from 'path'
import {
  biometricLabel,
  biometricTitle,
  endsBiometric,
  PASSWORD_DUE_MESSAGE,
  PASSWORD_MAX_AGE_MS,
  passwordLoginDue,
  sameEmail,
  unlockFailureMessage,
  unlockPlan,
} from '@/auth/biometricLogic'
import { createBiometricVault, type SecureStoreLike, type VaultStoreOptions } from '@/auth/biometricVault'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 28, 12)

// A secure store in memory. `scan` decides what the biometric prompt does on a locked read.
function fakeStore(scan: () => 'ok' | 'cancel' | 'fail' = () => 'ok') {
  const items = new Map<string, { value: string; locked: boolean }>()
  const calls: { op: string; key: string; options?: VaultStoreOptions }[] = []
  const store: SecureStoreLike = {
    async getItemAsync(key, options) {
      calls.push({ op: 'get', key, options })
      const item = items.get(key)
      if (!item) return null
      if (item.locked) {
        const r = scan()
        if (r === 'cancel') throw new Error('User canceled the authentication')
        if (r === 'fail') throw new Error('Authentication failed')
      }
      return item.value
    },
    async setItemAsync(key, value, options) {
      calls.push({ op: 'set', key, options })
      items.set(key, { value, locked: !!options?.requireAuthentication })
    },
    async deleteItemAsync(key, options) {
      calls.push({ op: 'delete', key, options })
      items.delete(key)
    },
  }
  return { store, items, calls }
}

function vaultWith(scan?: () => 'ok' | 'cancel' | 'fail') {
  const fake = fakeStore(scan)
  const vault = createBiometricVault({ store: fake.store, keychainAccessible: 7, isAvailable: () => true })
  return { vault, ...fake }
}

describe('3-month password rule', () => {
  it('is 90 days', () => expect(PASSWORD_MAX_AGE_MS).toBe(90 * DAY))
  it('asks for the password when it was never typed on this phone', () => {
    expect(passwordLoginDue(null, NOW)).toBe(true)
  })
  it('does not ask before 3 months', () => {
    expect(passwordLoginDue(NOW - 89 * DAY, NOW)).toBe(false)
  })
  it('asks at 3 months and after', () => {
    expect(passwordLoginDue(NOW - 90 * DAY, NOW)).toBe(true)
    expect(passwordLoginDue(NOW - 200 * DAY, NOW)).toBe(true)
  })
  it('treats a corrupt time as due', () => expect(passwordLoginDue(Number.NaN, NOW)).toBe(true))
})

describe('unlockPlan (what the app does when it opens)', () => {
  const base = { biometricEnabled: true, biometricAvailable: true, lastPasswordLoginAt: NOW - DAY, now: NOW, label: 'Face ID' }
  it('scans when biometric is on and the password is recent', () => {
    expect(unlockPlan(base)).toEqual({ kind: 'biometric' })
  })
  it('asks for the password, quietly, when biometric was never turned on (no remember me)', () => {
    expect(unlockPlan({ ...base, biometricEnabled: false })).toEqual({ kind: 'password', notice: null })
  })
  it('asks for the password every 3 months even though the scan would work', () => {
    expect(unlockPlan({ ...base, lastPasswordLoginAt: NOW - 91 * DAY })).toEqual({ kind: 'password', notice: PASSWORD_DUE_MESSAGE })
  })
  it('asks for the password when Face ID was removed from the phone', () => {
    const plan = unlockPlan({ ...base, biometricAvailable: false })
    expect(plan.kind).toBe('password')
    expect(plan.kind === 'password' && plan.notice).toMatch(/Face ID is not set up/)
  })
})

describe('labels and messages', () => {
  it('names Face ID on iPhone and fingerprint or face on Android', () => {
    expect(biometricLabel('ios')).toBe('Face ID')
    expect(biometricLabel('android')).toBe('fingerprint or face')
    expect(biometricTitle('android')).toBe('Fingerprint or face')
  })
  it('says what to do after each kind of failed unlock', () => {
    expect(unlockFailureMessage('cancelled', 'Face ID')).toMatch(/password, or try Face ID again/)
    expect(unlockFailureMessage('failed', 'Face ID')).toMatch(/didn't work/)
    expect(unlockFailureMessage('missing', 'Face ID')).toMatch(/turned on again on this phone/)
  })
  it('forgets the saved password only when the server says it can no longer work', () => {
    expect(endsBiometric('PASSWORD_CHANGED')).toBe(true)
    expect(endsBiometric('ACCOUNT_INACTIVE')).toBe(true)
    expect(endsBiometric('TEMP_PASSWORD_EXPIRED')).toBe(true)
    expect(endsBiometric(undefined)).toBe(false) // plain 12-hour expiry: the scan signs in again
  })
  it('compares emails the way the server does (case and spaces)', () => {
    expect(sameEmail(' Driver@Company.com', 'driver@company.com')).toBe(true)
    expect(sameEmail('a@x.com', 'b@x.com')).toBe(false)
    expect(sameEmail(null, 'a@x.com')).toBe(false)
  })
})

describe('biometric vault', () => {
  it('is off until turned on', async () => {
    const { vault } = vaultWith()
    expect(await vault.readMeta()).toBeNull()
    expect(await vault.unlock('Unlock')).toEqual({ ok: false, reason: 'missing' })
  })

  it('saves the password behind the biometric lock, on this phone only', async () => {
    const { vault, calls, items } = vaultWith()
    await vault.enable('driver@company.com', 'secret', NOW, 'Unlock')
    const savePassword = calls.find((c) => c.op === 'set' && c.key === 'saferoute_bio_password')!
    expect(savePassword.options).toMatchObject({ requireAuthentication: true, keychainAccessible: 7 })
    expect(items.get('saferoute_bio_password')!.locked).toBe(true)
    // The record of who and when holds no secret.
    expect(items.get('saferoute_bio_meta')!.value).not.toContain('secret')
    expect(await vault.readMeta()).toEqual({ email: 'driver@company.com', lastPasswordLoginAt: NOW })
  })

  it('a good scan gives back the email and password for a fresh sign-in', async () => {
    const { vault } = vaultWith(() => 'ok')
    await vault.enable('driver@company.com', 'secret', NOW, 'Unlock')
    expect(await vault.unlock('Unlock')).toEqual({ ok: true, email: 'driver@company.com', password: 'secret' })
  })

  it('a cancelled or failed scan keeps biometric on so the user can try again', async () => {
    let result: 'cancel' | 'fail' = 'cancel'
    const { vault } = vaultWith(() => result)
    await vault.enable('driver@company.com', 'secret', NOW, 'Unlock')
    expect(await vault.unlock('Unlock')).toEqual({ ok: false, reason: 'cancelled' })
    result = 'fail'
    expect(await vault.unlock('Unlock')).toEqual({ ok: false, reason: 'failed' })
    expect(await vault.readMeta()).not.toBeNull()
  })

  it('new phone or changed fingerprints (password gone): turns biometric off', async () => {
    const { vault, items } = vaultWith()
    await vault.enable('driver@company.com', 'secret', NOW, 'Unlock')
    items.delete('saferoute_bio_password') // what an invalidated key or a restored backup looks like
    expect(await vault.unlock('Unlock')).toEqual({ ok: false, reason: 'missing' })
    expect(await vault.readMeta()).toBeNull()
  })

  it('a typed password restarts the 3-month clock, only for the account that has biometric on', async () => {
    const { vault } = vaultWith()
    await vault.enable('driver@company.com', 'secret', NOW - 80 * DAY, 'Unlock')
    await vault.recordPasswordLogin('someone.else@company.com', NOW)
    expect((await vault.readMeta())!.lastPasswordLoginAt).toBe(NOW - 80 * DAY)
    await vault.recordPasswordLogin('Driver@Company.com', NOW)
    expect((await vault.readMeta())!.lastPasswordLoginAt).toBe(NOW)
  })

  it('turning it off removes both the password and the record', async () => {
    const { vault, items } = vaultWith()
    await vault.enable('driver@company.com', 'secret', NOW, 'Unlock')
    await vault.disable()
    expect(items.size).toBe(0)
  })

  it('a corrupt record reads as off', async () => {
    const { vault, store } = vaultWith()
    await store.setItemAsync('saferoute_bio_meta', '{not json')
    expect(await vault.readMeta()).toBeNull()
  })
})

// The token and the saved password live only in expo-secure-store (plan rule 6).
describe('auth storage stays in secure storage', () => {
  const dir = path.join(__dirname, '..', 'src', 'auth')
  it('no auth module imports AsyncStorage', () => {
    const hits = fs.readdirSync(dir).filter((f) => /from ['"]@react-native-async-storage/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    expect(hits).toEqual([])
  })
})
