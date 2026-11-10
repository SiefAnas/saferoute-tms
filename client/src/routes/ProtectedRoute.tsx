import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ROLE_HOME } from '../lib/roleHome'
import type { Role } from '../types/api'

// Guards a route subtree by auth + (optionally) role. An authenticated user hitting a
// route outside their role is sent to their own home, not to /login — they ARE logged in.
// An account still on a temporary password goes to /set-password first, then anyone who hasn't
// agreed to the current Terms of Use and Privacy Policy goes to /accept-terms.
export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user, token } = useAuth()

  if (!token || !user) return <Navigate to="/login" replace />
  if (user.must_change_password) return <Navigate to="/set-password" replace />
  if (user.legal_pending) return <Navigate to="/accept-terms" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to={ROLE_HOME[user.role]} replace />

  return <Outlet />
}
