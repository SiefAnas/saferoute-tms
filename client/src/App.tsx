import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { ROLE_HOME } from './lib/roleHome'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { AdminLayout } from './layouts/AdminLayout'
import { LoginPage } from './pages/login/LoginPage'
import { RegisterPage } from './pages/register/RegisterPage'
import { VerifyEmailPage } from './pages/register/VerifyEmailPage'
import { DriverDashboard } from './pages/driver/DriverDashboard'
import { CompanyAdminDashboard } from './pages/company/CompanyAdminDashboard'
import { DriversPage } from './pages/company/DriversPage'
import { ParentsPage } from './pages/company/ParentsPage'
import { VansPage } from './pages/company/VansPage'
import { AssignmentsPage } from './pages/company/AssignmentsPage'
import { PayrollPage } from './pages/company/PayrollPage'
import { CompanyStudentsPage } from './pages/company/StudentsPage'
import { StudentsPage } from './pages/school-admin/StudentsPage'
import { StaffAccessPage } from './pages/school-admin/StaffAccessPage'
import { SchoolProfilePage } from './pages/school-admin/SchoolProfilePage'
import { SchoolStaffDashboard } from './pages/school-staff/SchoolStaffDashboard'
import { ParentHomePage } from './pages/parent/ParentHomePage'
import { ParentDashboardMockup } from './mockups/parent-dashboard/ParentDashboardMockup'

// Order per Anas's explicit request: dashboard, driver, fleet, students, parents,
// assignments, payroll.
const COMPANY_NAV = [
  { to: '/company', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/company/drivers', label: 'Driver', icon: 'person' },
  { to: '/company/vans', label: 'Fleet', icon: 'local_shipping' },
  { to: '/company/students', label: 'Students', icon: 'groups' },
  { to: '/company/parents', label: 'Parents', icon: 'family_restroom' },
  { to: '/company/assignments', label: 'Assignments', icon: 'assignment' },
  { to: '/company/payroll', label: 'Payroll', icon: 'payments' },
]
const SCHOOL_ADMIN_NAV = [
  { to: '/school-admin', label: 'Students', icon: 'groups', end: true },
  { to: '/school-admin/staff', label: 'Staff & Access', icon: 'badge' },
  { to: '/school-admin/profile', label: 'School Profile', icon: 'school' },
]
const SCHOOL_STAFF_NAV = [{ to: '/school-staff', label: 'My Students', icon: 'groups', end: true }]
const DRIVER_NAV = [{ to: '/driver', label: 'Dashboard', icon: 'dashboard', end: true }]
const PARENT_NAV = [{ to: '/parent', label: 'My Students', icon: 'groups', end: true }]

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
      {/* TEMPORARY design-review route, unauthenticated on purpose — remove before any real
          deploy. Renders the isolated Parent Dashboard mockup (fake data except the Skip
          button) so it can be viewed without wiring it into real auth/data. See
          client/src/mockups/parent-dashboard/ParentDashboardMockup.tsx. */}
      <Route path="/mockup/parent-dashboard" element={<ParentDashboardMockup />} />

      <Route element={<ProtectedRoute roles={['driver']} />}>
        <Route element={<AdminLayout title="Driver Portal" navItems={DRIVER_NAV} />}>
          <Route path="/driver" element={<DriverDashboard />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['company_admin']} />}>
        <Route element={<AdminLayout title="Dispatcher Hub" navItems={COMPANY_NAV} />}>
          <Route path="/company" element={<CompanyAdminDashboard />} />
          <Route path="/company/drivers" element={<DriversPage />} />
          <Route path="/company/vans" element={<VansPage />} />
          <Route path="/company/assignments" element={<AssignmentsPage />} />
          <Route path="/company/payroll" element={<PayrollPage />} />
          <Route path="/company/students" element={<CompanyStudentsPage />} />
          <Route path="/company/parents" element={<ParentsPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['school_admin']} />}>
        <Route element={<AdminLayout title="School Hub" navItems={SCHOOL_ADMIN_NAV} />}>
          <Route path="/school-admin" element={<StudentsPage />} />
          <Route path="/school-admin/staff" element={<StaffAccessPage />} />
          <Route path="/school-admin/profile" element={<SchoolProfilePage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['school_staff']} />}>
        <Route element={<AdminLayout title="School Hub" navItems={SCHOOL_STAFF_NAV} />}>
          <Route path="/school-staff" element={<SchoolStaffDashboard />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['parent']} />}>
        <Route element={<AdminLayout title="Parent Portal" navItems={PARENT_NAV} />}>
          <Route path="/parent" element={<ParentHomePage />} />
        </Route>
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  )
}

export default App
