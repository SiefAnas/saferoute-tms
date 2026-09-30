import { API_BASE_URL } from '@/config'
import { createApi, type UnauthorizedInfo } from './client'

// One API instance for the whole app, so query functions can just import `api`.
// The token is kept in memory (the keychain read happens once at startup and on sign-in)
// and the 401 handler is wired up by AuthProvider.
let authToken: string | null = null
let unauthorizedHandler: (info: UnauthorizedInfo) => void = () => {}
let passwordChangeRequiredHandler: () => void = () => {}

export function setAuthToken(token: string | null): void {
  authToken = token
}

export function setUnauthorizedHandler(handler: (info: UnauthorizedInfo) => void): void {
  unauthorizedHandler = handler
}

export function setPasswordChangeRequiredHandler(handler: () => void): void {
  passwordChangeRequiredHandler = handler
}

export const api = createApi({
  baseUrl: API_BASE_URL,
  getToken: async () => authToken,
  onUnauthorized: (info) => unauthorizedHandler(info),
  onPasswordChangeRequired: () => passwordChangeRequiredHandler(),
})

export { ApiError, NetworkError } from './client'
export type { UnauthorizedInfo } from './client'
