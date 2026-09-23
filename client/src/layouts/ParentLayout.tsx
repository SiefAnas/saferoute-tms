import { Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { firstName, formatWeekdayDate, greeting } from '../lib/format'
import { MobileShell, type MobileTab } from '../components/mobile'

// Parent app shell. Phones: design 5b (the driver app's mobile look, two bottom tabs).
// Tablet/desktop: the website layout (sidebar + top bar), see MobileShell.
const TABS: MobileTab[] = [
  { to: '/parent', label: 'Students', icon: 'group', end: true },
  { to: '/parent/profile', label: 'Profile', icon: 'account_circle' },
]

export function ParentLayout() {
  const { user, logout } = useAuth()
  return (
    <MobileShell tabs={TABS} hubName="Parent" title={`${greeting()}, ${firstName(user?.full_name)}`} sub={formatWeekdayDate()} onLogout={logout}>
      <Outlet />
    </MobileShell>
  )
}
