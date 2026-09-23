import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { api } from './api'
import type { AuthUser, LoginResponse } from '../types/api'

const TOKEN_KEY = 'saferoute_token'
const USER_KEY = 'saferoute_user'

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  login: (email: string, password: string) => Promise<AuthUser>
  // Replace the session with a fresh token + user (after changing the password, the server
  // signs out older tokens and returns a new one).
  setSession: (res: LoginResponse) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser())

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setToken(null)
    setUser(null)
  }, [])

  // A 401 on any request (token expired/invalidated) clears storage in lib/api.ts and
  // signals here, so the UI drops back to the logged-out state instead of staying stale.
  useEffect(() => {
    window.addEventListener('saferoute:unauthorized', logout)
    return () => window.removeEventListener('saferoute:unauthorized', logout)
  }, [logout])

  // localStorage is shared across every tab of this origin, so logging into a different
  // account in one tab silently overwrites saferoute_token/saferoute_user for every other
  // open tab. The native `storage` event fires in those OTHER tabs (never the one that made
  // the change) whenever either key actually changes value. A full reload is simplest and
  // safest here: it also drops this tab's in-memory React Query cache, so nothing fetched
  // under the old account can linger and render against the new one.
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === TOKEN_KEY || e.key === USER_KEY) {
        window.location.reload()
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const setSession = useCallback((res: LoginResponse) => {
    localStorage.setItem(TOKEN_KEY, res.token)
    localStorage.setItem(USER_KEY, JSON.stringify(res.user))
    setToken(res.token)
    setUser(res.user)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<LoginResponse>('/auth/login', { email, password })
    setSession(res)
    return res.user
  }, [setSession])

  // The server says this session must set a new password first (lib/api.ts).
  useEffect(() => {
    function flag() {
      setUser((u) => {
        if (!u || u.must_change_password) return u
        const next = { ...u, must_change_password: true }
        localStorage.setItem(USER_KEY, JSON.stringify(next))
        return next
      })
    }
    window.addEventListener('saferoute:password-change-required', flag)
    return () => window.removeEventListener('saferoute:password-change-required', flag)
  }, [])

  return <AuthContext.Provider value={{ user, token, login, setSession, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
