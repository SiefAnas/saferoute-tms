import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, AppState, Platform } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, NetworkError, setAuthToken, setPasswordChangeRequiredHandler, setUnauthorizedHandler } from '@/api'
import type { AuthUser, LoginResponse, MeResponse } from '@/api/types'
import { unregisterThisDevice } from '@/features/notifications/push'
import { biometricToken } from './biometric'
import {
  biometricLabel,
  biometricTitle,
  sameEmail,
  TOKEN_EXPIRED_MESSAGE,
  unlockFailureMessage,
  unlockPlan,
} from './biometricLogic'
import { sessionEndedMessage } from './sessionMessages'
import { clearSession, deleteLegacySecrets, loadUser, saveUser } from './storage'

type Status = 'loading' | 'signedOut' | 'signedIn'

const BIO_LABEL = biometricLabel(Platform.OS)
const BIO_TITLE = biometricTitle(Platform.OS)
const UNLOCK_PROMPT = `Unlock with ${BIO_LABEL}`

export interface BiometricState {
  // "Face ID" / "fingerprint or face", and the sentence-start form for buttons.
  label: string
  title: string
  // The account that has biometric unlock on this phone, if any.
  email: string | null
  // On, a token is saved, and the password is not due: the login screen offers the scan.
  canUnlock: boolean
}

interface AuthValue {
  status: Status
  user: AuthUser | null
  // Sign in with a typed password. Afterwards the user is asked whether to turn on biometric
  // unlock (or, if it is already on for this account, the new token is locked behind it).
  signIn: (email: string, password: string) => Promise<AuthUser>
  // Scan, then use the saved token. null when the scan didn't work or the token has expired
  // (the reason is in expiredMessage); throws for errors the login screen shows itself.
  unlockWithBiometric: () => Promise<AuthUser | null>
  biometric: BiometricState
  // True once, right after the app opens with biometric on: the login screen starts the scan.
  consumeAutoUnlock: () => boolean
  // Set a new password (the first-login change from a temporary password). The server signs
  // out older tokens and returns a fresh one, which replaces the session.
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthUser>
  signOut: () => Promise<void>
  // Set when the session ended on its own (expired token, deactivated account) rather than
  // by the user tapping Log out, or when biometric unlock didn't work, so the login screen can
  // say why.
  expiredMessage: string | null
  clearExpiredMessage: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

function askToTurnOnBiometric(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      `Turn on ${BIO_TITLE}?`,
      `Next time you open the app, unlock it with ${BIO_LABEL} instead of typing your password. We'll still ask for your password when your sign-in expires, and once every 90 days.`,
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Turn on', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    )
  })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null)
  // Guards against several in-flight requests all 401-ing and each tearing down the session.
  const tearingDown = useRef(false)
  // True while a scanned token is being checked, so a plain 401 says "expired, enter your password".
  const unlocking = useRef(false)
  const [biometric, setBiometric] = useState<BiometricState>({
    label: BIO_LABEL,
    title: BIO_TITLE,
    email: null,
    canUnlock: false,
  })
  const autoUnlock = useRef(false)

  // Re-read the biometric record and say what the login screen can offer. Returns the plan.
  const refreshBiometric = useCallback(async () => {
    const meta = await biometricToken.readMeta()
    const plan = unlockPlan({
      biometricEnabled: meta !== null,
      tokenSaved: meta?.hasToken ?? false,
      biometricAvailable: biometricToken.isAvailable(),
      lastPasswordLoginAt: meta?.lastPasswordLoginAt ?? null,
      now: Date.now(),
      label: BIO_TITLE,
    })
    setBiometric({ label: BIO_LABEL, title: BIO_TITLE, email: meta?.email ?? null, canUnlock: plan.kind === 'biometric' })
    return plan
  }, [])

  // After a sign-in with a typed password, with the token it returned. Same account already
  // on: lock the new token behind the scan and restart the 90-day clock. Another account's:
  // forget it, this is a different person on the phone. Not on: ask.
  const offerBiometric = useCallback(
    async (email: string, token: string) => {
      if (!biometricToken.isAvailable()) return
      const meta = await biometricToken.readMeta()
      const now = Date.now()
      try {
        if (meta && sameEmail(meta.email, email)) {
          await biometricToken.enable(email, token, now, UNLOCK_PROMPT)
          return
        }
        if (meta) await biometricToken.disable()
        if (!(await askToTurnOnBiometric())) return
        await biometricToken.enable(email, token, now, UNLOCK_PROMPT)
        // iOS doesn't scan when saving, so scan once now: it proves Face ID works and shows the
        // permission question at the moment the user asked for it, not on the next app open.
        if (Platform.OS === 'ios') {
          const check = await biometricToken.unlock(UNLOCK_PROMPT)
          if (!check.ok) await biometricToken.disable()
        }
      } catch {
        // Scan cancelled while saving, or the keystore refused: leave it off, offer it next time.
        await biometricToken.disable()
      } finally {
        await refreshBiometric()
      }
    },
    [refreshBiometric],
  )

  // Drop everything that belonged to the signed-out user: the token (in memory and behind the
  // scan), the cached user record and every cached query result. Without the cache clear the
  // next person to sign in on this phone would see the previous driver's students for a moment
  // (API_CONTRACT.md §7). Biometric stays on for the account, ready for its next password sign-in.
  const teardown = useCallback(
    async (message: string | null) => {
      // Stop pushes to this phone for the person leaving (works without a session; not awaited,
      // so signing out never waits on the network).
      void unregisterThisDevice()
      setAuthToken(null)
      setUser(null)
      setStatus('signedOut')
      setExpiredMessage(message)
      queryClient.cancelQueries()
      queryClient.clear()
      await Promise.all([clearSession(), biometricToken.forgetToken()])
      await refreshBiometric()
    },
    [queryClient, refreshBiometric],
  )

  useEffect(() => {
    setUnauthorizedHandler((info) => {
      if (tearingDown.current) return
      tearingDown.current = true
      // Deactivated, password reset, temporary password expired or plain expiry: say which.
      // A plain expiry of a token the scan just unlocked: ask for the password.
      const message = unlocking.current && !info?.code ? TOKEN_EXPIRED_MESSAGE : sessionEndedMessage(info)
      void teardown(message).finally(() => {
        tearingDown.current = false
      })
    })
    // The server says this account is on a temporary password (e.g. just reset): flag the session
    // so the root layout sends the user to "set your password", the same rule as the website.
    setPasswordChangeRequiredHandler(() => {
      setUser((u) => {
        if (!u || u.must_change_password) return u
        const next = { ...u, must_change_password: true }
        void saveUser(next)
        return next
      })
    })
  }, [teardown])

  // Back to the foreground: prove the session again, so a deactivated or reset account is signed
  // out when the phone is picked up, not only on its next action. No signal: keep the session.
  useEffect(() => {
    if (status !== 'signedIn') return
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      api.get<MeResponse>('/auth/me').catch(() => {
        // A 401 already tore the session down (unauthorized handler); anything else is ignored.
      })
    })
    return () => sub.remove()
  }, [status])

  // App start. There is no "remember me": the session lasts until the app is closed. With
  // biometric on and a token saved, the login screen opens straight into the scan (see
  // unlockWithBiometric); otherwise, or once the password is 90 days old, the user types it.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await deleteLegacySecrets()
      const plan = await refreshBiometric()
      if (cancelled) return
      if (plan.kind === 'biometric') {
        autoUnlock.current = true
      } else {
        await clearSession()
        if (cancelled) return
        setExpiredMessage(plan.notice)
      }
      setStatus('signedOut')
    })()
    return () => {
      cancelled = true
    }
  }, [refreshBiometric])

  // A fresh token from POST /auth/login or change-password: in memory, plus the user record.
  const startSession = useCallback(
    async (res: LoginResponse) => {
      // Start from an empty cache: this may be a different person on a shared phone.
      queryClient.clear()
      setAuthToken(res.token)
      await saveUser(res.user)
      setExpiredMessage(null)
    },
    [queryClient],
  )

  const unlockWithBiometric = useCallback(async (): Promise<AuthUser | null> => {
    const plan = await refreshBiometric()
    if (plan.kind !== 'biometric') {
      setExpiredMessage(plan.notice)
      return null
    }
    const unlocked = await biometricToken.unlock(UNLOCK_PROMPT)
    if (!unlocked.ok) {
      if (unlocked.reason === 'missing') await refreshBiometric()
      setExpiredMessage(unlockFailureMessage(unlocked.reason, BIO_TITLE))
      return null
    }
    const stored = await loadUser()
    if (!stored || !sameEmail(stored.email, unlocked.email)) {
      // The token without its user record: start over with the password.
      await teardown(TOKEN_EXPIRED_MESSAGE)
      return null
    }
    setAuthToken(unlocked.token)
    unlocking.current = true
    try {
      // Prove the token. Expired (12 hours) or revoked: the 401 handler signs out and the user
      // types the password; nothing else is tried.
      await api.get<MeResponse>('/auth/me')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null
      if (!(err instanceof NetworkError)) {
        setAuthToken(null)
        throw err
      }
      // No signal: the scan proved it's the owner, so carry on with the token. The screens show
      // their own retry, and the first 401 once back online sends them to the password.
    } finally {
      unlocking.current = false
    }
    queryClient.clear()
    setExpiredMessage(null)
    setUser(stored)
    setStatus('signedIn')
    return stored
  }, [refreshBiometric, teardown, queryClient])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email.trim(), password)
      await startSession(res)
      await biometricToken.recordPasswordLogin(res.user.email, Date.now())
      // Not on a temporary password: that one is about to be replaced (see changePassword).
      if (!res.user.must_change_password) await offerBiometric(res.user.email, res.token)
      setUser(res.user)
      setStatus('signedIn')
      return res.user
    },
    [startSession, offerBiometric],
  )

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const res = await api.post<LoginResponse>('/auth/change-password', { currentPassword, newPassword })
      await startSession(res)
      // The first real password: the moment to offer biometric (or lock the new token).
      await offerBiometric(res.user.email, res.token)
      setUser(res.user)
      return res.user
    },
    [startSession, offerBiometric],
  )

  const signOut = useCallback(() => teardown(null), [teardown])

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      signIn,
      unlockWithBiometric,
      biometric,
      consumeAutoUnlock: () => {
        const pending = autoUnlock.current
        autoUnlock.current = false
        return pending
      },
      changePassword,
      signOut,
      expiredMessage,
      clearExpiredMessage: () => setExpiredMessage(null),
    }),
    [status, user, signIn, unlockWithBiometric, biometric, changePassword, signOut, expiredMessage],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
