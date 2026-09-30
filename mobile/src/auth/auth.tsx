import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, NetworkError, setAuthToken, setPasswordChangeRequiredHandler, setUnauthorizedHandler } from '@/api'
import type { AuthUser, LoginResponse, MeResponse } from '@/api/types'
import { sessionEndedMessage } from './sessionMessages'
import { clearSession, loadSession, saveSession } from './storage'

type Status = 'loading' | 'signedOut' | 'signedIn'

interface AuthValue {
  status: Status
  user: AuthUser | null
  signIn: (email: string, password: string) => Promise<AuthUser>
  // Set a new password (the first-login change from a temporary password). The server signs
  // out older tokens and returns a fresh one, which replaces the stored session.
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthUser>
  signOut: () => Promise<void>
  // Set when the session ended on its own (expired token, deactivated account) rather than
  // by the user tapping Log out, so the login screen can say why.
  expiredMessage: string | null
  clearExpiredMessage: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null)
  // Guards against several in-flight requests all 401-ing and each tearing down the session.
  const tearingDown = useRef(false)
  // The live token, for re-saving the session when only the user record changes.
  const tokenRef = useRef<string | null>(null)

  // Drop everything that belonged to the signed-out user: the token, the cached user record
  // and every cached query result. Without the cache clear the next person to sign in on this
  // phone would see the previous driver's students for a moment (API_CONTRACT.md §7).
  const teardown = useCallback(
    async (message: string | null) => {
      setAuthToken(null)
      tokenRef.current = null
      setUser(null)
      setStatus('signedOut')
      setExpiredMessage(message)
      queryClient.cancelQueries()
      queryClient.clear()
      await clearSession()
    },
    [queryClient],
  )

  useEffect(() => {
    setUnauthorizedHandler((info) => {
      if (tearingDown.current) return
      tearingDown.current = true
      // Deactivated, password reset, temporary password expired or plain expiry: say which.
      void teardown(sessionEndedMessage(info)).finally(() => {
        tearingDown.current = false
      })
    })
    // The server says this account is on a temporary password (e.g. just reset): flag the session
    // so the root layout sends the user to "set your password", the same rule as the website.
    setPasswordChangeRequiredHandler(() => {
      setUser((u) => {
        if (!u || u.must_change_password) return u
        const next = { ...u, must_change_password: true }
        if (tokenRef.current) void saveSession({ token: tokenRef.current, user: next })
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

  // App start: read the stored session, then prove it with GET /auth/me. The token lasts 12
  // hours with no refresh, so a stale one is normal and just means "sign in again".
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const stored = await loadSession()
      if (cancelled) return
      if (!stored) {
        setStatus('signedOut')
        return
      }
      setAuthToken(stored.token)
      tokenRef.current = stored.token
      try {
        await api.get<MeResponse>('/auth/me')
        if (cancelled) return
        setUser(stored.user)
        setStatus('signedIn')
      } catch (err) {
        if (cancelled) return
        if (err instanceof NetworkError) {
          // Started with no signal (or Render still waking up). Keep the session and let the
          // screens show their own retry — signing the driver out here would be wrong and
          // they could not sign back in without a connection anyway.
          setUser(stored.user)
          setStatus('signedIn')
          return
        }
        // A 401 here already went through the unauthorized handler with the specific reason.
        if (!(err instanceof ApiError && err.status === 401)) await teardown(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [teardown])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email.trim(), password)
      // Start from an empty cache: this may be a different person on a shared phone.
      queryClient.clear()
      setAuthToken(res.token)
      tokenRef.current = res.token
      await saveSession({ token: res.token, user: res.user })
      setUser(res.user)
      setExpiredMessage(null)
      setStatus('signedIn')
      return res.user
    },
    [queryClient],
  )

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const res = await api.post<LoginResponse>('/auth/change-password', { currentPassword, newPassword })
    setAuthToken(res.token)
    tokenRef.current = res.token
    await saveSession({ token: res.token, user: res.user })
    setUser(res.user)
    return res.user
  }, [])

  const signOut = useCallback(() => teardown(null), [teardown])

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      signIn,
      changePassword,
      signOut,
      expiredMessage,
      clearExpiredMessage: () => setExpiredMessage(null),
    }),
    [status, user, signIn, changePassword, signOut, expiredMessage],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
