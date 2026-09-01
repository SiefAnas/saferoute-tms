import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ContactLink } from '../components/ContactLink'

interface NavItem {
  to: string
  label: string
  icon: string
  end?: boolean
}

// DESIGN.md "Layout & Spacing": admin screens use a fluid 12-column grid with a fixed
// sidebar shell — shared here across company_admin and (later) school_admin, parameterized
// by title/nav so each role's own section list can differ without duplicating the shell.
//
// The subtitle line shows the authenticated user's own email rather than an org display
// name: there's no API endpoint to look up a company/school's name by id, so a hardcoded
// or guessed org name would silently show the WRONG organization for any user other than
// the one it was hardcoded for (caught live: a freshly-registered company showed the
// original seed company's name here). Revisit once such a lookup endpoint exists.
//
// Collapsible sidebar (2026-08-28): clicking the truck icon toggles the sidebar. ASSUMPTION:
// the task said clicking it "hides it if open, shows it again if clicked again" — taken
// literally, a fully-hidden sidebar would hide the truck icon too, leaving no way to bring
// it back. Kept a slim always-visible icon rail (just the toggle button) so it stays
// reachable; everything else (title, nav labels, logout) hides/shows with it.
export function AdminLayout({
  title,
  navItems,
}: {
  title: string
  navItems: NavItem[]
}) {
  const { user, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex h-screen bg-background text-on-surface">
      <aside
        className={`hidden shrink-0 flex-col gap-2 overflow-y-auto border-r border-outline-variant bg-surface-container-low py-6 transition-[width] duration-200 md:flex ${
          collapsed ? 'w-16 px-2' : 'w-64 px-4'
        }`}
      >
        <div className={`mb-6 flex items-center gap-4 px-2 ${collapsed ? 'justify-center' : ''}`}>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-container transition-colors hover:opacity-80"
          >
            <span className="material-symbols-outlined text-on-primary-fixed">local_shipping</span>
          </button>
          {!collapsed && (
            <div>
              <h1 className="text-headline-md font-bold text-primary">{title}</h1>
              <p className="text-label-md text-secondary opacity-70">
                <ContactLink type="email" value={user?.email} />
              </p>
            </div>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-4 rounded-lg px-4 py-2 transition-colors ${collapsed ? 'justify-center px-0' : ''} ${
                  isActive
                    ? 'bg-primary-container font-bold text-on-primary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-high'
                }`
              }
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              {!collapsed && <span className="text-label-md">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-1 border-t border-outline-variant pt-4">
          {!collapsed && <div className="px-4 py-2 text-label-md text-on-surface-variant">{user?.full_name}</div>}
          <button
            type="button"
            onClick={logout}
            title={collapsed ? 'Logout' : undefined}
            className={`flex items-center gap-4 rounded-lg px-4 py-2 text-left text-on-surface-variant transition-colors hover:bg-surface-container-high ${
              collapsed ? 'justify-center px-0' : ''
            }`}
          >
            <span className="material-symbols-outlined">logout</span>
            {!collapsed && <span className="text-label-md">Logout</span>}
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
