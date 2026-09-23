import { Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { firstName, formatWeekdayDate, greeting } from '../lib/format'
import { MobileHeader, MobileShell, type MobileTab } from '../components/mobile'
import { useMyVan } from '../pages/driver/driverData'

const TABS: MobileTab[] = [
  { to: '/driver', label: 'Today', icon: 'route', end: true },
  { to: '/driver/trips', label: 'Trips', icon: 'receipt_long' },
  { to: '/driver/week', label: 'Week', icon: 'calendar_view_week' },
  { to: '/driver/pay', label: 'Pay', icon: 'payments' },
]

// Driver app shell (design 3a), modeled on ParentLayout: no sidebar, a scroll area, a fixed
// bottom tab bar. The header is on every tab: greeting by name, today's date and the van from
// the driver's current assignment. (The design says "Van 04"; vans have no fleet number yet,
// so this shows brand + model and the plate. See DESIGN_REPORT.md.)
export function DriverLayout() {
  const { user, logout } = useAuth()
  const van = useMyVan()
  return (
    <MobileShell
      tabs={TABS}
      header={
        <MobileHeader
          title={`${greeting()}, ${firstName(user?.full_name)}`}
          onLogout={logout}
          sub={
            <>
              {formatWeekdayDate()}
              {van ? (
                <>
                  {' · '}
                  <b className="font-semibold text-ink">
                    {van.brand} {van.model}
                  </b>
                  {' · '}
                  {van.license_plate}
                </>
              ) : (
                ' · No van assigned today'
              )}
            </>
          }
        />
      }
    >
      <Outlet />
    </MobileShell>
  )
}
