import { sameEmail, type UnlockFailure } from './biometricLogic'

// The login token behind the biometric lock, plus a small record of whose it is and when the
// password was last typed. No password is ever saved: a scan only gives back the token from the
// last password sign-in. It takes the secure store as a dependency so the tests need no
// keychain; src/auth/biometric.ts wires it to expo-secure-store.

export interface SecureStoreLike {
  getItemAsync(key: string, options?: TokenStoreOptions): Promise<string | null>
  setItemAsync(key: string, value: string, options?: TokenStoreOptions): Promise<void>
  deleteItemAsync(key: string, options?: TokenStoreOptions): Promise<void>
}

export interface TokenStoreOptions {
  requireAuthentication?: boolean
  authenticationPrompt?: string
  keychainAccessible?: number
}

export interface BiometricMeta {
  email: string
  // Epoch ms of the last sign-in with a typed password (the 90-day rule).
  lastPasswordLoginAt: number
  // False once the locked token is gone (signed out, or the server rejected it): the scan has
  // nothing to unlock until the next password sign-in saves a new one.
  hasToken: boolean
}

export type UnlockResult = { ok: true; email: string; token: string } | { ok: false; reason: UnlockFailure }

const META_KEY = 'saferoute_bio_meta'
const TOKEN_KEY = 'saferoute_bio_token'

export function createBiometricTokenStore(deps: {
  store: SecureStoreLike
  // Keeps the items on this phone only (iOS WHEN_PASSCODE_SET_THIS_DEVICE_ONLY), so they never
  // travel to a new phone in a backup.
  keychainAccessible?: number
  isAvailable: () => boolean
}) {
  const { store, keychainAccessible } = deps
  const plain: TokenStoreOptions = { keychainAccessible }
  const locked = (prompt?: string): TokenStoreOptions => ({
    ...plain,
    requireAuthentication: true,
    ...(prompt ? { authenticationPrompt: prompt } : {}),
  })

  async function readMeta(): Promise<BiometricMeta | null> {
    try {
      const raw = await store.getItemAsync(META_KEY, plain)
      if (!raw) return null
      const meta = JSON.parse(raw) as Partial<BiometricMeta>
      if (typeof meta.email !== 'string' || typeof meta.lastPasswordLoginAt !== 'number') return null
      return { email: meta.email, lastPasswordLoginAt: meta.lastPasswordLoginAt, hasToken: meta.hasToken === true }
    } catch {
      return null
    }
  }

  const writeMeta = (meta: BiometricMeta) => store.setItemAsync(META_KEY, JSON.stringify(meta), plain)

  async function disable(): Promise<void> {
    await Promise.all([
      store.deleteItemAsync(TOKEN_KEY, locked()).catch(() => {}),
      store.deleteItemAsync(META_KEY, plain).catch(() => {}),
    ])
  }

  return {
    isAvailable: deps.isAvailable,
    readMeta,
    disable,

    // Lock the token from a password sign-in behind the scan. Only called right after the
    // password was typed, so it also restarts the 90-day clock. Android shows the scan here.
    async enable(email: string, token: string, now: number, prompt: string): Promise<void> {
      await store.setItemAsync(TOKEN_KEY, token, locked(prompt))
      await writeMeta({ email, lastPasswordLoginAt: now, hasToken: true })
    },

    // A typed-password sign-in for the account that has biometric on: restart the 90-day clock.
    async recordPasswordLogin(email: string, now: number): Promise<void> {
      const meta = await readMeta()
      if (!meta || !sameEmail(meta.email, email)) return
      await writeMeta({ ...meta, lastPasswordLoginAt: now })
    },

    // Signed out, or the token expired / was rejected: delete it but keep biometric on, so the
    // next password sign-in for this account locks the new token without asking again.
    async forgetToken(): Promise<void> {
      await store.deleteItemAsync(TOKEN_KEY, locked()).catch(() => {})
      const meta = await readMeta()
      if (meta?.hasToken) await writeMeta({ ...meta, hasToken: false })
    },

    // Shows the scan and reads the token back.
    async unlock(prompt: string): Promise<UnlockResult> {
      const meta = await readMeta()
      if (!meta || !meta.hasToken) return { ok: false, reason: 'missing' }
      let token: string | null
      try {
        token = await store.getItemAsync(TOKEN_KEY, locked(prompt))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, reason: /cancel/i.test(message) ? 'cancelled' : 'failed' }
      }
      // Should be there but isn't: a new phone, or the phone's fingerprints / face changed,
      // which invalidates the key. Turn biometric off; it can be turned on again after a
      // password sign-in.
      if (!token) {
        await disable()
        return { ok: false, reason: 'missing' }
      }
      return { ok: true, email: meta.email, token }
    },
  }
}

export type BiometricTokenStore = ReturnType<typeof createBiometricTokenStore>
