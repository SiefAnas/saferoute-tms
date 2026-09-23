import { Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { firstName, formatWeekdayDate, greeting } from '../lib/format'
import { MobileShell, type MobileTab } from '../components/mobile'
import { useMyVan } from '../pages/driver/driverData'
import { vanName } from '../lib/fleet'

const TABS: MobileTab[] = [
  { to: '/driver', label: 'Today', icon: 'route', end: true },
  { to: '/driver/trips', label: 'Trips', icon: 'receipt_long' },
  { to: '/driver/week', label: 'Week', icon: 'calendar_view_week', comingSoon: 'The week schedule' },
  { to: '/driver/pay', label: 'Pay', icon: 'payments' },
]

// Driver app shell. Phones: design 3a (scroll area + fixed bottom tab bar). Tablet/desktop: the
// website layout (sidebar + top bar), see MobileShell. The header is on every tab: greeting by
// name, today's date and the van from the driver's current assignment ("Van 04" when the van
// has a fleet number, else make + model).
export function DriverLayout() {
  const { user, logout } = useAuth()
  const van = useMyVan()
  return (
    <MobileShell
      tabs={TABS}
      hubName="Driver"
      title={`${greeting()}, ${firstName(user?.full_name)}`}
      onLogout={logout}
      sub={
            <>
              {formatWeekdayDate()}
              {van ? (
                <>
                  {' · '}
                  <b className="font-semibold text-ink">{vanName(van)}</b>
                  {' · '}
                  {van.license_plate}
                </>
              ) : (
                ' · No van assigned today'
              )}
            </>
          }
    >
      <Outlet />
    </MobileShell>
  )
}
