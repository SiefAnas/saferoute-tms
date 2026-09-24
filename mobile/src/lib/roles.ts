import type { Role } from '@/api/types'

// Where each role lands after signing in. Drivers, monitors and parents have a mobile app; the
// other three roles run the business from the website, so they get an explanatory screen
// instead of a half-built version of it.
export type RoleDestination = '/(driver)/today' | '/(parent)/students' | '/(monitor)/home' | '/unsupported'

export function destinationForRole(role: Role | null | undefined): RoleDestination {
  switch (role) {
    case 'driver':
      return '/(driver)/today'
    case 'parent':
      return '/(parent)/students'
    case 'monitor':
      return '/(monitor)/home'
    default:
      // company_admin, school_admin, school_staff, and any role added to the API later.
      return '/unsupported'
  }
}

export function isMobileRole(role: Role | null | undefined): boolean {
  return role === 'driver' || role === 'parent' || role === 'monitor'
}
