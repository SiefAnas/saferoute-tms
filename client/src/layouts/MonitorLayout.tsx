import { Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { firstName, formatWeekdayDate, greeting } from '../lib/format'
import { vanName } from '../lib/fleet'
import { MobileShell, type MobileTab } from '../components/mobile'
import { useMonitorHome } from '../pages/monitor/monitorData'

const TABS: MobileTab[] = [
  { to: '/monitor', label: 'Today', icon: 'badge', end: true },
  { to: '/monitor/pay', label: 'Pay', icon: 'payments' },
]

// Monitor app shell (monitor-role): the driver app's look with two tabs. Phones get the mobile
// layout, tablets and desktops the website layout (see MobileShell). The header names the van
// the monitor rides in, like the driver's.
export function MonitorLayout() {
  const { user, logout } = useAuth()
  const home = useMonitorHome().data
  return (
    <MobileShell
      tabs={TABS}
      hubName="Monitor"
      title={`${greeting()}, ${firstName(user?.full_name)}`}
      onLogout={logout}
      sub={
        <>
          {formatWeekdayDate()}
          {home?.van ? (
            <>
              {' · '}
              <b className="font-semibold text-ink">{vanName(home.van)}</b>
              {' · '}
              {home.van.license_plate}
            </>
          ) : null}
        </>
      }
    >
      <Outlet />
    </MobileShell>
  )
}
