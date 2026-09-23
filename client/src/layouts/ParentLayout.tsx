import { Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { firstName, formatWeekdayDate, greeting } from '../lib/format'
import { MobileHeader, MobileShell, type MobileTab } from '../components/mobile'

// Parent app shell (design 5b): the driver app's mobile look (3a tokens + dark mode), with two
// bottom tabs. Kept at every breakpoint, centered on wide screens, since there's no desktop nav
// to fall back to.
const TABS: MobileTab[] = [
  { to: '/parent', label: 'Students', icon: 'group', end: true },
  { to: '/parent/profile', label: 'Profile', icon: 'account_circle' },
]

export function ParentLayout() {
  const { user, logout } = useAuth()
  return (
    <MobileShell
      tabs={TABS}
      header={<MobileHeader title={`${greeting()}, ${firstName(user?.full_name)}`} sub={formatWeekdayDate()} onLogout={logout} />}
    >
      <Outlet />
    </MobileShell>
  )
}
