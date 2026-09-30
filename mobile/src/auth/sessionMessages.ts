import type { UnauthorizedInfo } from '@/api/client'

// What the login screen says after the server ended the session on its own. The specific cases
// come from the server's `code` (see server/src/middleware/authenticate.js).
export function sessionEndedMessage(info: UnauthorizedInfo | undefined): string {
  switch (info?.code) {
    case 'TEMP_PASSWORD_EXPIRED':
      return 'Your temporary password has expired. Ask your admin to reset it.'
    case 'ACCOUNT_INACTIVE':
      return 'This account is no longer active. Contact your company if you think this is a mistake.'
    case 'PASSWORD_CHANGED':
      return 'Your password was changed or reset. Sign in with the new one.'
    default:
      return 'Your session has ended. Please sign in again.'
  }
}
