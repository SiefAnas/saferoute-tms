import type { LoginResponse } from './types'

// The API answers every error with `{ "error": "human readable message" }` and those messages
// are written for people, so ApiError.message is what the UI shows for 400/403/409
// (API_CONTRACT.md §1).
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// Anything that stopped the request from reaching the API: no signal, DNS, TLS, or the Render
// service taking longer than our timeout to wake up. Separated from ApiError so screens can
// offer "Try again" instead of showing a server message that doesn't exist.
export class NetworkError extends Error {
  constructor(message = 'Could not reach SafeRoute. Check your connection and try again.') {
    super(message)
    this.name = 'NetworkError'
  }
}

export interface ApiDeps {
  baseUrl: string
  // Read the bearer token. Async because it lives in the device keychain.
  getToken: () => Promise<string | null>
  // Called on any 401 that isn't the login call itself: the token is dead and there is no
  // refresh token (API_CONTRACT.md §2), so the session has to be torn down.
  onUnauthorized: () => void
  fetchImpl?: typeof fetch
  // Render can spin the API down; the first call after a quiet period is slow, so this is
  // generous on purpose. Better a long spinner than a false "no connection".
  timeoutMs?: number
}

export interface Api {
  get: <T>(path: string) => Promise<T>
  post: <T>(path: string, body?: unknown) => Promise<T>
  login: (email: string, password: string) => Promise<LoginResponse>
}

export function createApi(deps: ApiDeps): Api {
  const doFetch = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? 45_000

  async function request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    const isLogin = path === '/auth/login'
    if (!isLogin) {
      const token = await deps.getToken()
      if (token) headers.Authorization = `Bearer ${token}`
    }

    // AbortController rather than a racing timer, so a request we gave up on stops using the
    // radio instead of finishing in the background.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let res: Response
    try {
      res = await doFetch(`${deps.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } catch {
      throw new NetworkError()
    } finally {
      clearTimeout(timer)
    }

    // A 401 on a normal call means the 12-hour token expired or the account was deactivated.
    // Login's own 401 is "invalid credentials" and must not clear an existing session.
    if (res.status === 401 && !isLogin) deps.onUnauthorized()

    let payload: unknown = null
    try {
      payload = await res.json()
    } catch {
      // No JSON body (204, or an HTML error page from a proxy) — leave it null.
    }

    if (!res.ok) {
      const message = (payload as { error?: string } | null)?.error
      throw new ApiError(res.status, message ?? fallbackMessage(res.status))
    }
    return payload as T
  }

  return {
    get: (path) => request(path, 'GET'),
    post: (path, body) => request(path, 'POST', body),
    login: (email, password) => request<LoginResponse>('/auth/login', 'POST', { email, password }),
  }
}

// Only used when the API returned a non-JSON error (a proxy or gateway page), so there is no
// server message to show.
function fallbackMessage(status: number): string {
  if (status === 401) return 'Your session has ended. Please sign in again.'
  if (status === 404) return 'Not found.'
  if (status === 429) return 'Too many attempts. Please wait a few minutes and try again.'
  if (status >= 500) return 'SafeRoute had a problem. Please try again in a moment.'
  return `Request failed (${status}).`
}
