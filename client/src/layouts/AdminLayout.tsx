import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

interface NavItem {
  to: string
  label: string
  icon: string
  end?: boolean
}

// DESIGN.md "Layout & Spacing": admin screens use a fluid 12-column grid with a fixed
// sidebar shell — shared here across company_admin and (later) school_admin, parameterized
// by title/nav so each role's own section list can differ without duplicating the shell.
export function AdminLayout({
  title,
  subtitle,
  navItems,
}: {
  title: string
  subtitle: string
  navItems: NavItem[]
}) {
  const { user, logout } = useAuth()

  return (
    <div className="flex h-screen bg-background text-on-surface">
      <aside className="hidden w-64 shrink-0 flex-col gap-2 overflow-y-auto border-r border-outline-variant bg-surface-container-low px-4 py-6 md:flex">
        <div className="mb-6 flex items-center gap-4 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-container">
            <span className="material-symbols-outlined text-on-primary-fixed">local_shipping</span>
          </div>
          <div>
            <h1 className="text-headline-md font-bold text-primary">{title}</h1>
            <p className="text-label-md text-secondary opacity-70">{subtitle}</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-4 rounded-lg px-4 py-2 transition-colors ${
                  isActive
                    ? 'bg-primary-container font-bold text-on-primary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-high'
                }`
              }
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="text-label-md">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-1 border-t border-outline-variant pt-4">
          <div className="px-4 py-2 text-label-md text-on-surface-variant">{user?.full_name}</div>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-4 rounded-lg px-4 py-2 text-left text-on-surface-variant transition-colors hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined">logout</span>
            <span className="text-label-md">Logout</span>
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto bg-background p-6">
          <div className="mx-auto max-w-[1440px]">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
