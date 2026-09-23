import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { ROLE_HOME } from './lib/roleHome'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { AdminLayout, type NavGroup } from './layouts/AdminLayout'
import { ParentLayout } from './layouts/ParentLayout'
import { LoginPage } from './pages/login/LoginPage'
import { RegisterPage } from './pages/register/RegisterPage'
import { VerifyEmailPage } from './pages/register/VerifyEmailPage'
import { DriverLayout } from './layouts/DriverLayout'
import { DriverTodayPage } from './pages/driver/DriverTodayPage'
import { DriverTripsPage } from './pages/driver/DriverTripsPage'
import { DriverWeekPage } from './pages/driver/DriverWeekPage'
import { DriverPayPage } from './pages/driver/DriverPayPage'
import { CompanyAdminDashboard } from './pages/company/CompanyAdminDashboard'
import { DriversPage } from './pages/company/DriversPage'
import { ParentsPage } from './pages/company/ParentsPage'
import { VansPage } from './pages/company/VansPage'
import { AssignmentsPage } from './pages/company/AssignmentsPage'
import { PayrollPage } from './pages/company/PayrollPage'
import { CompanyStudentsPage } from './pages/company/StudentsPage'
import { CompanyProfilePage } from './pages/company/CompanyProfilePage'
import { StudentsPage } from './pages/school-admin/StudentsPage'
import { StaffAccessPage } from './pages/school-admin/StaffAccessPage'
import { SchoolProfilePage } from './pages/school-admin/SchoolProfilePage'
import { SchoolStaffDashboard } from './pages/school-staff/SchoolStaffDashboard'
import { ParentHomePage } from './pages/parent/ParentHomePage'
import { ParentProfilePage } from './pages/parent/ParentProfilePage'

// Sidebar nav per role (design 5a, "Sidebar"): grouped, with the only uppercase text in the app
// as the group labels. Company order keeps Anas's earlier dashboard → drivers → fleet → … order
// inside the design's groups.
const COMPANY_NAV: NavGroup[] = [
  { items: [{ to: '/company', label: 'Dashboard', icon: 'dashboard', end: true }] },
  {
    label: 'Operations',
    items: [
      { to: '/company/drivers', label: 'Drivers', icon: 'person', badge: 'live-drivers' },
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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />

      <Route element={<ProtectedRoute roles={['driver']} />}>
        <Route element={<DriverLayout />}>
          <Route path="/driver" element={<DriverTodayPage />} />
          <Route path="/driver/trips" element={<DriverTripsPage />} />
          <Route path="/driver/week" element={<DriverWeekPage />} />
          <Route path="/driver/pay" element={<DriverPayPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['company_admin']} />}>
        <Route element={<AdminLayout hubName="Dispatcher Hub" nav={COMPANY_NAV} />}>
          <Route path="/company" element={<CompanyAdminDashboard />} />
          <Route path="/company/drivers" element={<DriversPage />} />
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
  )
}

export default App
