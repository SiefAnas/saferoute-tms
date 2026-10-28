import { sameEmail, type UnlockFailure } from './biometricLogic'

// The biometric-locked copy of the password plus a small record of who it belongs to and when
// the password was last typed. It takes the secure store as a dependency so the tests need no
// keychain; src/auth/biometric.ts wires it to expo-secure-store.

export interface SecureStoreLike {
  getItemAsync(key: string, options?: VaultStoreOptions): Promise<string | null>
  setItemAsync(key: string, value: string, options?: VaultStoreOptions): Promise<void>
  deleteItemAsync(key: string, options?: VaultStoreOptions): Promise<void>
}

export interface VaultStoreOptions {
  requireAuthentication?: boolean
  authenticationPrompt?: string
  keychainAccessible?: number
}

export interface BiometricMeta {
  email: string
  // Epoch ms of the last sign-in with a typed password (the 3-month rule).
  lastPasswordLoginAt: number
}

export type UnlockResult = { ok: true; email: string; password: string } | { ok: false; reason: UnlockFailure }

const META_KEY = 'saferoute_bio_meta'
const PASSWORD_KEY = 'saferoute_bio_password'

export function createBiometricVault(deps: {
  store: SecureStoreLike
  // Keeps the items on this phone only (iOS WHEN_PASSCODE_SET_THIS_DEVICE_ONLY), so they never
  // travel to a new phone in a backup.
  keychainAccessible?: number
  isAvailable: () => boolean
}) {
  const { store, keychainAccessible } = deps
  const plain: VaultStoreOptions = { keychainAccessible }

  async function readMeta(): Promise<BiometricMeta | null> {
    try {
      const raw = await store.getItemAsync(META_KEY, plain)
      if (!raw) return null
      const meta = JSON.parse(raw) as Partial<BiometricMeta>
      if (typeof meta.email !== 'string' || typeof meta.lastPasswordLoginAt !== 'number') return null
      return { email: meta.email, lastPasswordLoginAt: meta.lastPasswordLoginAt }
    } catch {
      return null
    }
  }

  async function disable(): Promise<void> {
    await Promise.all([
      store.deleteItemAsync(PASSWORD_KEY, { ...plain, requireAuthentication: true }).catch(() => {}),
      store.deleteItemAsync(META_KEY, plain).catch(() => {}),
    ])
  }

  return {
    isAvailable: deps.isAvailable,
    readMeta,
    disable,

    // Save the password behind the biometric lock. Only called right after the password was
    // typed, so it also resets the 3-month clock. Android shows the scan here; iOS does not.
    async enable(email: string, password: string, now: number, prompt: string): Promise<void> {
      await store.setItemAsync(PASSWORD_KEY, password, {
        ...plain,
        requireAuthentication: true,
        authenticationPrompt: prompt,
      })
      await store.setItemAsync(META_KEY, JSON.stringify({ email, lastPasswordLoginAt: now }), plain)
    },

    // A typed-password sign-in for the account that has biometric on: restart the 3-month clock.
    async recordPasswordLogin(email: string, now: number): Promise<void> {
      const meta = await readMeta()
      if (!meta || !sameEmail(meta.email, email)) return
      await store.setItemAsync(META_KEY, JSON.stringify({ ...meta, lastPasswordLoginAt: now }), plain)
    },

    // Shows the scan and reads the password back.
    async unlock(prompt: string): Promise<UnlockResult> {
      const meta = await readMeta()
      if (!meta) return { ok: false, reason: 'missing' }
      let password: string | null
      try {
        password = await store.getItemAsync(PASSWORD_KEY, {
          ...plain,
          requireAuthentication: true,
          authenticationPrompt: prompt,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, reason: /cancel/i.test(message) ? 'cancelled' : 'failed' }
      }
      // Gone: a new phone, or the phone's fingerprints / face changed, which invalidates the key.
      if (!password) {
        await disable()
        return { ok: false, reason: 'missing' }
      }
      return { ok: true, email: meta.email, password }
    },
  }
}

export type BiometricVault = ReturnType<typeof createBiometricVault>
