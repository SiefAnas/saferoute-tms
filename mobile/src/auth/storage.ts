import * as SecureStore from 'expo-secure-store'
import type { AuthUser } from '@/api/types'

// The JWT goes in the device keychain / EncryptedSharedPreferences, never AsyncStorage
// (API_CONTRACT.md §2). The cached user record goes with it: it is not a secret, but keeping
// both in the same place means one clear() can't leave half a session behind.
const TOKEN_KEY = 'saferoute_token'
const USER_KEY = 'saferoute_user'

export interface StoredSession {
  token: string
  user: AuthUser
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const [token, rawUser] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ])
    if (!token || !rawUser) return null
    return { token, user: JSON.parse(rawUser) as AuthUser }
  } catch {
    // Unreadable or corrupt keychain entry: treat it as "not signed in" rather than blocking
    // the app on the login screen forever.
    return null
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, session.token),
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(session.user)),
  ])
}

export async function clearSession(): Promise<void> {
  await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY), SecureStore.deleteItemAsync(USER_KEY)])
}
