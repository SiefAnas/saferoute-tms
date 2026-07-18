import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { ROLE_HOME } from './lib/roleHome'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { DriverLayout } from './layouts/DriverLayout'
import { AdminLayout } from './layouts/AdminLayout'
import { LoginPage } from './pages/login/LoginPage'
import { RegisterPage } from './pages/register/RegisterPage'
import { VerifyEmailPage } from './pages/register/VerifyEmailPage'
import { DriverDashboard } from './pages/driver/DriverDashboard'
import { CompanyAdminDashboard } from './pages/company/CompanyAdminDashboard'
import { VansPage } from './pages/company/VansPage'
import { AssignmentsPage } from './pages/company/AssignmentsPage'
import { PayrollPage } from './pages/company/PayrollPage'
import { CompanyStudentsPage } from './pages/company/StudentsPage'
import { StudentsPage } from './pages/school-admin/StudentsPage'
import { StaffAccessPage } from './pages/school-admin/StaffAccessPage'
import { SchoolStaffDashboard } from './pages/school-staff/SchoolStaffDashboard'

const COMPANY_NAV = [
  { to: '/company', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/company/vans', label: 'Fleet', icon: 'local_shipping' },
  { to: '/company/assignments', label: 'Assignments', icon: 'assignment' },
  { to: '/company/payroll', label: 'Payroll', icon: 'payments' },
  { to: '/company/students', label: 'Students', icon: 'groups' },
]
const SCHOOL_ADMIN_NAV = [
  { to: '/school-admin', label: 'Students', icon: 'groups', end: true },
  { to: '/school-admin/staff', label: 'Staff & Access', icon: 'badge' },
]
const SCHOOL_STAFF_NAV = [{ to: '/school-staff', label: 'My Students', icon: 'groups', end: true }]

function RootRedirect() {
  const { user, token } = useAuth()
  if (!token || !user) return <Navigate to="/login" replace />
  return <Navigate to={ROLE_HOME[user.role]} replace />
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />

      <Route element={<ProtectedRoute roles={['driver']} />}>
        <Route element={<DriverLayout />}>
          <Route path="/driver" element={<DriverDashboard />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['company_admin']} />}>
        <Route element={<AdminLayout title="Dispatcher Hub" navItems={COMPANY_NAV} />}>
          <Route path="/company" element={<CompanyAdminDashboard />} />
          <Route path="/company/vans" element={<VansPage />} />
          <Route path="/company/assignments" element={<AssignmentsPage />} />
          <Route path="/company/payroll" element={<PayrollPage />} />
          <Route path="/company/students" element={<CompanyStudentsPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['school_admin']} />}>
        <Route element={<AdminLayout title="School Hub" navItems={SCHOOL_ADMIN_NAV} />}>
          <Route path="/school-admin" element={<StudentsPage />} />
          <Route path="/school-admin/staff" element={<StaffAccessPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['school_staff']} />}>
        <Route element={<AdminLayout title="School Hub" navItems={SCHOOL_STAFF_NAV} />}>
          <Route path="/school-staff" element={<SchoolStaffDashboard />} />
        </Route>
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  )
}

export default App
