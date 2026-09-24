import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { ROLE_HOME } from './lib/roleHome'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { AdminLayout, type NavGroup } from './layouts/AdminLayout'
import { ParentLayout } from './layouts/ParentLayout'
import { LoginPage } from './pages/login/LoginPage'
import { RegisterPage } from './pages/register/RegisterPage'
import { VerifyEmailPage } from './pages/register/VerifyEmailPage'
import { ForgotPasswordPage, ResetPasswordPage, SetPasswordPage } from './pages/login/PasswordPages'
import { DriverLayout } from './layouts/DriverLayout'
import { MonitorLayout } from './layouts/MonitorLayout'

// Each role's screens load on demand, so a driver's phone never downloads the admin pages.
const DriverTodayPage = lazy(() => import('./pages/driver/DriverTodayPage').then((m) => ({ default: m.DriverTodayPage })))
const DriverTripsPage = lazy(() => import('./pages/driver/DriverTripsPage').then((m) => ({ default: m.DriverTripsPage })))
const DriverWeekPage = lazy(() => import('./pages/driver/DriverWeekPage').then((m) => ({ default: m.DriverWeekPage })))
const DriverPayPage = lazy(() => import('./pages/driver/DriverPayPage').then((m) => ({ default: m.DriverPayPage })))
const MonitorTodayPage = lazy(() => import('./pages/monitor/MonitorTodayPage').then((m) => ({ default: m.MonitorTodayPage })))
const MonitorsPage = lazy(() => import('./pages/company/MonitorsPage').then((m) => ({ default: m.MonitorsPage })))
const CompanyAdminDashboard = lazy(() => import('./pages/company/CompanyAdminDashboard').then((m) => ({ default: m.CompanyAdminDashboard })))
const DriversPage = lazy(() => import('./pages/company/DriversPage').then((m) => ({ default: m.DriversPage })))
const ParentsPage = lazy(() => import('./pages/company/ParentsPage').then((m) => ({ default: m.ParentsPage })))
const VansPage = lazy(() => import('./pages/company/VansPage').then((m) => ({ default: m.VansPage })))
const AssignmentsPage = lazy(() => import('./pages/company/AssignmentsPage').then((m) => ({ default: m.AssignmentsPage })))
const PayrollPage = lazy(() => import('./pages/company/PayrollPage').then((m) => ({ default: m.PayrollPage })))
const CompanyStudentsPage = lazy(() => import('./pages/company/StudentsPage').then((m) => ({ default: m.CompanyStudentsPage })))
const CompanyProfilePage = lazy(() => import('./pages/company/CompanyProfilePage').then((m) => ({ default: m.CompanyProfilePage })))
const StudentsPage = lazy(() => import('./pages/school-admin/StudentsPage').then((m) => ({ default: m.StudentsPage })))
const StaffAccessPage = lazy(() => import('./pages/school-admin/StaffAccessPage').then((m) => ({ default: m.StaffAccessPage })))
const SchoolProfilePage = lazy(() => import('./pages/school-admin/SchoolProfilePage').then((m) => ({ default: m.SchoolProfilePage })))
const SchoolStaffDashboard = lazy(() => import('./pages/school-staff/SchoolStaffDashboard').then((m) => ({ default: m.SchoolStaffDashboard })))
const ParentHomePage = lazy(() => import('./pages/parent/ParentHomePage').then((m) => ({ default: m.ParentHomePage })))
const ParentProfilePage = lazy(() => import('./pages/parent/ParentProfilePage').then((m) => ({ default: m.ParentProfilePage })))

// Sidebar nav per role (design 5a, "Sidebar"): grouped, with the only uppercase text in the app
// as the group labels. Company order keeps Anas's earlier dashboard → drivers → fleet → … order
// inside the design's groups.
const COMPANY_NAV: NavGroup[] = [
  { items: [{ to: '/company', label: 'Dashboard', icon: 'dashboard', end: true }] },
  {
    label: 'Operations',
    items: [
      { to: '/company/drivers', label: 'Drivers', icon: 'person', badge: 'live-drivers' },
      { to: '/company/monitors', label: 'Monitors', icon: 'badge' },
      { to: '/company/vans', label: 'Fleet', icon: 'local_shipping' },
      { to: '/company/assignments', label: 'Assignments', icon: 'assignment' },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/company/students', label: 'Students', icon: 'groups' },
      { to: '/company/parents', label: 'Parents', icon: 'family_restroom' },
    ],
  },
  { label: 'Finance', items: [{ to: '/company/payroll', label: 'Payroll', icon: 'payments' }] },
  { label: 'Settings', items: [{ to: '/company/profile', label: 'Company profile', icon: 'apartment' }] },
]
const SCHOOL_ADMIN_NAV: NavGroup[] = [
  {
    items: [
      { to: '/school-admin', label: 'Students', icon: 'groups', end: true },
      { to: '/school-admin/pickup', label: 'Pickup & drop-off', icon: 'how_to_reg' },
    ],
  },
  { label: 'People', items: [{ to: '/school-admin/staff', label: 'Staff & access', icon: 'badge' }] },
  { label: 'Settings', items: [{ to: '/school-admin/profile', label: 'School profile', icon: 'school' }] },
]
const SCHOOL_STAFF_NAV: NavGroup[] = [
  { items: [{ to: '/school-staff', label: 'Pickup & drop-off', icon: 'how_to_reg', end: true }] },
]
function RootRedirect() {
  const { user, token } = useAuth()
  if (!token || !user) return <Navigate to="/login" replace />
  return <Navigate to={ROLE_HOME[user.role]} replace />
}

function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />

        <Route element={<ProtectedRoute roles={['driver']} />}>
          <Route element={<DriverLayout />}>
            <Route path="/driver" element={<DriverTodayPage />} />
            <Route path="/driver/trips" element={<DriverTripsPage />} />
            <Route path="/driver/week" element={<DriverWeekPage />} />
            <Route path="/driver/pay" element={<DriverPayPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute roles={['monitor']} />}>
          <Route element={<MonitorLayout />}>
            <Route path="/monitor" element={<MonitorTodayPage />} />
            {/* Same page as the driver's Pay tab: own pay rule + own sessions only. */}
            <Route path="/monitor/pay" element={<DriverPayPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute roles={['company_admin']} />}>
          <Route element={<AdminLayout hubName="Dispatcher Hub" nav={COMPANY_NAV} />}>
            <Route path="/company" element={<CompanyAdminDashboard />} />
            <Route path="/company/drivers" element={<DriversPage />} />
            <Route path="/company/monitors" element={<MonitorsPage />} />
            <Route path="/company/vans" element={<VansPage />} />
            <Route path="/company/assignments" element={<AssignmentsPage />} />
            <Route path="/company/payroll" element={<PayrollPage />} />
            <Route path="/company/students" element={<CompanyStudentsPage />} />
            <Route path="/company/parents" element={<ParentsPage />} />
            <Route path="/company/profile" element={<CompanyProfilePage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute roles={['school_admin']} />}>
          <Route element={<AdminLayout hubName="School Hub" nav={SCHOOL_ADMIN_NAV} />}>
            <Route path="/school-admin" element={<StudentsPage />} />
            <Route path="/school-admin/pickup" element={<SchoolStaffDashboard />} />
            <Route path="/school-admin/staff" element={<StaffAccessPage />} />
            <Route path="/school-admin/profile" element={<SchoolProfilePage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute roles={['school_staff']} />}>
          <Route element={<AdminLayout hubName="School Hub" nav={SCHOOL_STAFF_NAV} />}>
            <Route path="/school-staff" element={<SchoolStaffDashboard />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute roles={['parent']} />}>
          <Route element={<ParentLayout />}>
            <Route path="/parent" element={<ParentHomePage />} />
            <Route path="/parent/profile" element={<ParentProfilePage />} />
          </Route>
        </Route>

        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </Suspense>
  )
}

export default App
