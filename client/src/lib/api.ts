// Thin fetch wrapper: base /api (proxied to the Express API by Vite, see vite.config.ts),
// attaches the JWT, and normalizes errors. A 401 clears the stored session — the caller
// (ProtectedRoute) is responsible for redirecting, since this module has no router access.
const API_BASE = '/api'
const TOKEN_KEY = 'saferoute_token'
const USER_KEY = 'saferoute_user'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })

  if (res.status === 401 && path !== '/auth/login') {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    // Let AuthProvider react to a session expiring mid-app (not just at initial login),
    // without this module needing to depend on React/the router.
    window.dispatchEvent(new Event('saferoute:unauthorized'))
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // No JSON body (e.g. 204 No Content) — leave body as null.
  }

  if (!res.ok) {
    const message = (body as { error?: string } | null)?.error ?? res.statusText
    throw new ApiError(res.status, message)
  }
  return body as T
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path, { method: 'GET' }),
  post: <T>(path: string, data?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: data !== undefined ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
}
