import type { Role } from '@/api/types'

// Where each role lands after signing in. Every role has a mobile app now: drivers, monitors and
// parents their full one; company admins, school admins and school staff a lighter one (the
// day's overview, people and students, tap to call), with "Open on the website" for the rest.
// A role the API adds later still gets the explanatory screen, never someone else's app.
export type RoleDestination =
  | '/(driver)/today'
  | '/(parent)/students'
  | '/(monitor)/home'
  | '/(company)/home'
  | '/(school)/pickup'
  | '/unsupported'

export function destinationForRole(role: Role | null | undefined): RoleDestination {
  switch (role) {
    case 'driver':
      return '/(driver)/today'
    case 'parent':
      return '/(parent)/students'
    case 'monitor':
      return '/(monitor)/home'
    case 'company_admin':
      return '/(company)/home'
    case 'school_admin':
    case 'school_staff':
      return '/(school)/pickup'
    default:
      // Any role added to the API later.
      return '/unsupported'
  }
}

export function isMobileRole(role: Role | null | undefined): boolean {
  return destinationForRole(role) !== '/unsupported'
}
