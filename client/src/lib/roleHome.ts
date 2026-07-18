import type { Role } from '../types/api'

// Where each role lands after login / at the app root.
export const ROLE_HOME: Record<Role, string> = {
  driver: '/driver',
  company_admin: '/company',
  // Not built yet (Step 4 continues with these) — routed so login doesn't dead-end.
  school_admin: '/school-admin',
  school_staff: '/school-staff',
}
