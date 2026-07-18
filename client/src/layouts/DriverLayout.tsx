import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

// DESIGN.md "Layout & Spacing": mobile driver shell uses fixed generous margins and a
// bottom tab bar with 56px-tall tap targets for high-vibration, thumb-only environments.
const NAV_ITEMS = [{ to: '/driver', label: 'Home', icon: 'dashboard', end: true }]

export function DriverLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="sticky top-0 z-50 flex items-center justify-between bg-surface-bright px-4 py-4">
        <div className="flex flex-col">
          <span className="text-headline-lg-mobile font-bold text-primary">SafeRoute</span>
          <span className="text-label-md text-on-surface-variant">Driver Portal</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-body-md text-on-surface-variant sm:inline">{user?.full_name}</span>
          <button
            type="button"
            onClick={logout}
            aria-label="Log out"
            className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container"
          >
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-2 pb-32">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 z-50 flex w-full justify-around border-t border-outline-variant bg-surface-container-lowest px-4 pt-2 pb-4">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center px-4 py-2 transition-transform active:scale-95 ${
                isActive ? 'text-primary' : 'text-on-surface-variant'
              }`
            }
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className="text-label-md">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
