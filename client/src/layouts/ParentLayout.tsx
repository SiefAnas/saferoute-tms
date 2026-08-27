import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

// Parent-specific shell — deliberately its own layout, not the shared AdminLayout sidebar
// every other role uses (Anas's explicit call: adapt the Stitch reference's own top-bar +
// bottom-tab-bar structure for parents, rather than force it into the admin sidebar shell).
// Kept at every breakpoint (not just mobile like the reference) since there's no desktop
// nav here to fall back to otherwise.
const TABS = [
  { to: '/parent', label: 'Students', icon: 'group', end: true },
  { to: '/parent/profile', label: 'Profile', icon: 'account_circle' },
]

export function ParentLayout() {
  const { logout } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-background text-on-background">
      <header className="sticky top-0 z-40 flex h-14 w-full items-center justify-between border-b border-outline-variant bg-surface px-4">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-primary">local_shipping</span>
          <h1 className="text-headline-sm font-bold text-primary">SafeRoute TMS</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Notifications"
            title="Notifications (not built yet)"
            className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined">notifications</span>
          </button>
          <button
            type="button"
            onClick={logout}
            aria-label="Logout"
            className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-5 pb-24">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 z-50 flex h-20 w-full items-center justify-around border-t border-outline-variant bg-surface px-2 pb-2 shadow-sm">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex min-w-[64px] flex-col items-center justify-center rounded-2xl px-4 py-1 transition-colors ${
                isActive ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-container-high'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className="material-symbols-outlined mb-1" style={{ fontVariationSettings: `'FILL' ${isActive ? 1 : 0}` }}>
                  {tab.icon}
                </span>
                <span className={`text-label-md ${isActive ? 'font-bold' : ''}`}>{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
