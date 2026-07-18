import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { ROLE_HOME } from './lib/roleHome'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { DriverLayout } from './layouts/DriverLayout'
import { AdminLayout } from './layouts/AdminLayout'
import { LoginPage } from './pages/login/LoginPage'
import { DriverDashboard } from './pages/driver/DriverDashboard'
import { CompanyAdminDashboard } from './pages/company/CompanyAdminDashboard'
import { ComingSoonPage } from './pages/ComingSoonPage'

const COMPANY_NAV = [{ to: '/company', label: 'Dashboard', icon: 'dashboard', end: true }]

function RootRedirect() {
  const { user, token } = useAuth()
  if (!token || !user) return <Navigate to="/login" replace />
  return <Navigate to={ROLE_HOME[user.role]} replace />
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute roles={['driver']} />}>
        <Route element={<DriverLayout />}>
          <Route path="/driver" element={<DriverDashboard />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['company_admin']} />}>
        <Route element={<AdminLayout title="Dispatcher Hub" subtitle="3 Bees Transportation" navItems={COMPANY_NAV} />}>
          <Route path="/company" element={<CompanyAdminDashboard />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['school_admin']} />}>
        <Route path="/school-admin" element={<ComingSoonPage title="School Admin" />} />
      </Route>
      <Route element={<ProtectedRoute roles={['school_staff']} />}>
        <Route path="/school-staff" element={<ComingSoonPage title="School Staff" />} />
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  )
}

export default App
