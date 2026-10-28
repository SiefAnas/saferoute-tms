import fs from 'fs'
import path from 'path'
import {
  biometricLabel,
  biometricTitle,
  PASSWORD_DUE_MESSAGE,
  PASSWORD_MAX_AGE_MS,
  passwordLoginDue,
  sameEmail,
  unlockFailureMessage,
  unlockPlan,
} from '@/auth/biometricLogic'
import { createBiometricTokenStore, type SecureStoreLike, type TokenStoreOptions } from '@/auth/biometricToken'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 28, 12)

// A secure store in memory. `scan` decides what the biometric prompt does on a locked read.
function fakeStore(scan: () => 'ok' | 'cancel' | 'fail' = () => 'ok') {
  const items = new Map<string, { value: string; locked: boolean }>()
  const calls: { op: string; key: string; options?: TokenStoreOptions }[] = []
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

function storeWith(scan?: () => 'ok' | 'cancel' | 'fail') {
  const fake = fakeStore(scan)
  const tokens = createBiometricTokenStore({ store: fake.store, keychainAccessible: 7, isAvailable: () => true })
  return { tokens, ...fake }
}

describe('90-day password rule', () => {
  it('is 90 days', () => expect(PASSWORD_MAX_AGE_MS).toBe(90 * DAY))
  it('asks for the password when it was never typed on this phone', () => {
    expect(passwordLoginDue(null, NOW)).toBe(true)
  })
  it('does not ask before 90 days', () => {
    expect(passwordLoginDue(NOW - 89 * DAY, NOW)).toBe(false)
  })
  it('asks at 90 days and after', () => {
    expect(passwordLoginDue(NOW - 90 * DAY, NOW)).toBe(true)
    expect(passwordLoginDue(NOW - 200 * DAY, NOW)).toBe(true)
  })
  it('treats a corrupt time as due', () => expect(passwordLoginDue(Number.NaN, NOW)).toBe(true))
})

describe('unlockPlan (what the app does when it opens)', () => {
  const base = {
    biometricEnabled: true,
    tokenSaved: true,
    biometricAvailable: true,
    lastPasswordLoginAt: NOW - DAY,
    now: NOW,
    label: 'Face ID',
  }
  it('scans when biometric is on, a token is saved and the password is recent', () => {
    expect(unlockPlan(base)).toEqual({ kind: 'biometric' })
  })
  it('asks for the password, quietly, when biometric was never turned on (no remember me)', () => {
    expect(unlockPlan({ ...base, biometricEnabled: false })).toEqual({ kind: 'password', notice: null })
  })
  it('asks for the password when there is no token to unlock (signed out or expired)', () => {
    expect(unlockPlan({ ...base, tokenSaved: false })).toEqual({ kind: 'password', notice: null })
  })
  it('asks for the password every 90 days even though the scan would work', () => {
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
  it('compares emails the way the server does (case and spaces)', () => {
    expect(sameEmail(' Driver@Company.com', 'driver@company.com')).toBe(true)
    expect(sameEmail('a@x.com', 'b@x.com')).toBe(false)
    expect(sameEmail(null, 'a@x.com')).toBe(false)
  })
})

describe('biometric token store', () => {
  it('is off until turned on', async () => {
    const { tokens } = storeWith()
    expect(await tokens.readMeta()).toBeNull()
    expect(await tokens.unlock('Unlock')).toEqual({ ok: false, reason: 'missing' })
  })

  it('locks the token behind the scan, on this phone only, and stores nothing else secret', async () => {
    const { tokens, calls, items } = storeWith()
    await tokens.enable('driver@company.com', 'jwt-abc', NOW, 'Unlock')
    const saveToken = calls.find((c) => c.op === 'set' && c.key === 'saferoute_bio_token')!
    expect(saveToken.options).toMatchObject({ requireAuthentication: true, keychainAccessible: 7 })
    expect(items.get('saferoute_bio_token')!.locked).toBe(true)
    expect(items.get('saferoute_bio_meta')!.value).not.toContain('jwt-abc')
    expect([...items.keys()].sort()).toEqual(['saferoute_bio_meta', 'saferoute_bio_token'])
    expect(await tokens.readMeta()).toEqual({ email: 'driver@company.com', lastPasswordLoginAt: NOW, hasToken: true })
  })

  it('a good scan gives back the token, never a password', async () => {
    const { tokens } = storeWith(() => 'ok')
    await tokens.enable('driver@company.com', 'jwt-abc', NOW, 'Unlock')
    const result = await tokens.unlock('Unlock')
    expect(result).toEqual({ ok: true, email: 'driver@company.com', token: 'jwt-abc' })
    expect(result).not.toHaveProperty('password')
  })

  it('a cancelled or failed scan keeps biometric on so the user can try again', async () => {
    let result: 'cancel' | 'fail' = 'cancel'
    const { tokens } = storeWith(() => result)
    await tokens.enable('driver@company.com', 'jwt-abc', NOW, 'Unlock')
    expect(await tokens.unlock('Unlock')).toEqual({ ok: false, reason: 'cancelled' })
    result = 'fail'
    expect(await tokens.unlock('Unlock')).toEqual({ ok: false, reason: 'failed' })
    expect(await tokens.readMeta()).not.toBeNull()
  })

  it('signed out or token expired: the token is deleted, biometric stays on for the next password sign-in', async () => {
    const { tokens, items } = storeWith()
    await tokens.enable('driver@company.com', 'jwt-abc', NOW, 'Unlock')
    await tokens.forgetToken()
    expect(items.has('saferoute_bio_token')).toBe(false)
    expect(await tokens.readMeta()).toEqual({ email: 'driver@company.com', lastPasswordLoginAt: NOW, hasToken: false })
    expect(await tokens.unlock('Unlock')).toEqual({ ok: false, reason: 'missing' })
    // The next password sign-in locks its new token.
    await tokens.enable('driver@company.com', 'jwt-new', NOW + DAY, 'Unlock')
    expect(await tokens.unlock('Unlock')).toEqual({ ok: true, email: 'driver@company.com', token: 'jwt-new' })
  })

  it('new phone or changed fingerprints (token unreadable): turns biometric off', async () => {
    const { tokens, items } = storeWith()
    await tokens.enable('driver@company.com', 'jwt-abc', NOW, 'Unlock')
    items.delete('saferoute_bio_token') // what an invalidated key or a restored backup looks like
    expect(await tokens.unlock('Unlock')).toEqual({ ok: false, reason: 'missing' })
    expect(await tokens.readMeta()).toBeNull()
  })

  it('a typed password restarts the 90-day clock, only for the account that has biometric on', async () => {
    const { tokens } = storeWith()
    await tokens.enable('driver@company.com', 'jwt-abc', NOW - 80 * DAY, 'Unlock')
    await tokens.recordPasswordLogin('someone.else@company.com', NOW)
    expect((await tokens.readMeta())!.lastPasswordLoginAt).toBe(NOW - 80 * DAY)
    await tokens.recordPasswordLogin('Driver@Company.com', NOW)
    expect((await tokens.readMeta())!.lastPasswordLoginAt).toBe(NOW)
  })

  it('turning it off removes the token and the record', async () => {
    const { tokens, items } = storeWith()
    await tokens.enable('driver@company.com', 'jwt-abc', NOW, 'Unlock')
    await tokens.disable()
    expect(items.size).toBe(0)
  })

  it('a corrupt record reads as off', async () => {
    const { tokens, store } = storeWith()
    await store.setItemAsync('saferoute_bio_meta', '{not json')
    expect(await tokens.readMeta()).toBeNull()
  })
})

// The token lives only in expo-secure-store, and no password is ever saved on the phone.
describe('auth storage rules', () => {
  const dir = path.join(__dirname, '..', 'src', 'auth')
  const sources = fs.readdirSync(dir).map((f) => ({ f, text: fs.readFileSync(path.join(dir, f), 'utf8') }))

  it('no auth module imports AsyncStorage', () => {
    expect(sources.filter((s) => /from ['"]@react-native-async-storage/.test(s.text)).map((s) => s.f)).toEqual([])
  })
  it('the password vault is gone', () => {
    expect(sources.map((s) => s.f)).not.toContain('biometricVault.ts')
  })
  it('nothing hands a password to secure storage or to the biometric token store', () => {
    const hits = sources.filter((s) => /(setItemAsync|biometricToken\.enable)\([^)]*password/i.test(s.text)).map((s) => s.f)
    expect(hits).toEqual([])
  })
  it('the password saved by the first biometric release is deleted on app start', () => {
    const storage = sources.find((s) => s.f === 'storage.ts')!.text
    expect(storage).toMatch(/LEGACY_KEYS = \[[^\]]*'saferoute_bio_password'/)
    expect(sources.find((s) => s.f === 'auth.tsx')!.text).toMatch(/await deleteLegacySecrets\(\)/)
  })
})
