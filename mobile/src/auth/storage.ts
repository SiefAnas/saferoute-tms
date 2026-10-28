import * as SecureStore from 'expo-secure-store'
import type { AuthUser } from '@/api/types'

// The cached user record for the session, in the device keychain / EncryptedSharedPreferences,
// never AsyncStorage (API_CONTRACT.md §2). It is not a secret. The login token is not saved
// here: it lives in memory while the app is open and, with biometric on, behind the biometric
// lock (src/auth/biometricToken.ts).
const USER_KEY = 'saferoute_user'

// Left behind by earlier versions of the app: the plain token, and the biometric-locked
// password from the first biometric release. Deleted on every app start so no phone keeps them.
const LEGACY_KEYS = ['saferoute_token', 'saferoute_bio_password']

export async function loadUser(): Promise<AuthUser | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    // Unreadable or corrupt keychain entry: treat it as "not signed in".
    return null
  }
}

export async function saveUser(user: AuthUser): Promise<void> {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user))
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(USER_KEY)
}

export async function deleteLegacySecrets(): Promise<void> {
  await Promise.all(LEGACY_KEYS.map((key) => SecureStore.deleteItemAsync(key).catch(() => {})))
}
