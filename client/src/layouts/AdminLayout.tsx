import { Suspense, useCallback, useMemo, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ThemeToggle } from '../components/ThemeToggle'
import { TopBarContext, type TopBarSlots } from './TopBar'
import type { Company, DriverSession, Role, School } from '../types/api'

export interface NavItem {
  to: string
  label: string
  icon: string
  end?: boolean
  // 'live-drivers' shows a green "{n} live" pill: drivers with an open shift right now.
  badge?: 'live-drivers'
}

export interface NavGroup {
  label?: string // uppercase group label; the first group usually has none (Dashboard)
  items: NavItem[]
}

const ROLE_LABEL: Record<Role, string> = {
  company_admin: 'Company admin',
  school_admin: 'School admin',
  school_staff: 'School staff',
  driver: 'Driver',
  parent: 'Parent',
  monitor: 'Monitor',
}

function initials(name: string | undefined) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

// Admin web shell (design 3b / 5a): slate sidebar with the amber hub tile, grouped nav, and a
// footer with the signed-in user, the theme toggle and logout; a 64px top bar whose title and
// actions each page fills in through <PageTopBar>. Shared by company_admin, school_admin and
// school_staff, configured by `nav`.
//
// Kept from before: the collapse-to-rail toggle (clicking the hub tile) and the phone-width
// drawer (without it a phone has no way to reach nav or logout).
export function AdminLayout({ hubName, nav }: { hubName: string; nav: NavGroup[] }) {
  const { user, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [slots, setSlots] = useState<TopBarSlots>({ title: null, actions: null })
  // Stable ref callbacks: an inline one is re-created every render, which makes React call it
  // with null then the node again, and each call here is a state update.
  const titleRef = useCallback((el: HTMLDivElement | null) => setSlots((s) => (s.title === el ? s : { ...s, title: el })), [])
  const actionsRef = useCallback((el: HTMLDivElement | null) => setSlots((s) => (s.actions === el ? s : { ...s, actions: el })), [])
  const location = useLocation()

  const isCompany = user?.role === 'company_admin'
  const companyQuery = useQuery({
    queryKey: ['company-me'],
    queryFn: () => api.get<Company>('/companies/me'),
    enabled: isCompany,
  })
  const schoolQuery = useQuery({
    queryKey: ['school-me'],
    queryFn: () => api.get<School>('/schools/me'),
    enabled: user?.role === 'school_admin' || user?.role === 'school_staff',
  })
  const orgName = isCompany ? companyQuery.data?.name : schoolQuery.data?.name

  const needsLive = nav.some((g) => g.items.some((i) => i.badge === 'live-drivers'))
  const sessionsQuery = useQuery({
    queryKey: ['sessions', 'all'],
    queryFn: () => api.get<DriverSession[]>('/sessions'),
    enabled: needsLive,
  })
  const liveCount = useMemo(
    () => new Set((sessionsQuery.data ?? []).filter((s) => s.check_out_at === null).map((s) => s.user_id)).size,
    [sessionsQuery.data],
  )

  // The nav label of the current page, the top bar's title when the page doesn't set one.
  const currentLabel = useMemo(() => {
    const items = nav.flatMap((g) => g.items)
    const match = items
      .filter((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)))
      .sort((a, b) => b.to.length - a.to.length)[0]
    return match?.label ?? hubName
  }, [nav, location.pathname, hubName])

  const renderNav = (opts: { rail: boolean; onNavigate?: () => void }) => (
    <nav className="flex flex-1 flex-col gap-0.5">
      {nav.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-0.5">
          {group.label &&
            (opts.rail ? (
              gi > 0 && <div className="mx-2 my-2 border-t border-sidebar-line" />
            ) : (
              <span className="px-2.5 pt-4 pb-1.5 text-group-label text-sidebar-label">{group.label}</span>
            ))}
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={opts.onNavigate}
              title={opts.rail ? item.label : undefined}
              className={({ isActive }) =>
                `flex h-[38px] items-center gap-3 rounded-btn px-2.5 text-[14px] transition-colors ${
                  opts.rail ? 'justify-center px-0' : ''
                } ${isActive ? 'bg-amber font-semibold text-on-amber' : 'text-sidebar-ink hover:bg-sidebar-hover'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`material-symbols-outlined !text-[20px] ${isActive ? '' : 'text-sidebar-icon'}`}>{item.icon}</span>
                  {!opts.rail && <span className="truncate">{item.label}</span>}
                  {!opts.rail && item.badge === 'live-drivers' && liveCount > 0 && (
                    <span className="ml-auto rounded-[9px] bg-success-fg px-[7px] py-0.5 text-[11px] font-semibold text-success-bg">
                      {liveCount} live
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )

  const brand = (rail: boolean) => (
    <div className={`flex items-center gap-2.5 px-2 pb-5 ${rail ? 'justify-center px-0' : ''}`}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
        className="flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-btn bg-amber hover:bg-amber-hover"
      >
        <span className="material-symbols-outlined !text-[20px] text-on-amber">local_shipping</span>
      </button>
      {!rail && (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-display text-[15px] font-bold text-sidebar-strong">{hubName}</span>
          <span className="truncate text-[12px] text-sidebar-icon">{orgName ?? ' '}</span>
        </div>
      )}
    </div>
  )

  const footer = (rail: boolean): ReactNode => (
    <div
      className={`mt-auto flex items-center gap-2.5 border-t border-sidebar-line px-2.5 pt-3 ${rail ? 'flex-col px-0' : ''}`}
    >
      {!rail && (
        <>
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-sidebar-chip text-[11px] font-bold text-sidebar-strong">
            {initials(user?.full_name)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-semibold text-sidebar-strong">{user?.full_name}</span>
            <span className="truncate text-[12px] text-sidebar-icon">{user ? ROLE_LABEL[user.role] : ''}</span>
          </div>
        </>
      )}
      <ThemeToggle variant="sidebar" />
      <button
        type="button"
        onClick={logout}
        aria-label="Log out"
        title="Log out"
        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-row text-sidebar-icon hover:bg-sidebar-hover hover:text-sidebar-strong"
      >
        <span className="material-symbols-outlined !text-[20px]">logout</span>
      </button>
    </div>
  )

  return (
    <div className="flex h-screen flex-col bg-bg text-ink md:flex-row">
      {/* Phone-width header: the sidebar is hidden below md, so this is the way to nav + logout. */}
      <header className="flex h-14 shrink-0 items-center justify-between bg-sidebar px-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open menu"
          className="flex h-10 w-10 items-center justify-center rounded-row text-sidebar-ink hover:bg-sidebar-hover"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>
        <span className="font-display text-[15px] font-bold text-sidebar-strong">{hubName}</span>
        <ThemeToggle variant="sidebar" />
      </header>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-scrim" onClick={() => setMobileNavOpen(false)} />
          <aside className="relative flex h-full w-64 flex-col gap-0.5 overflow-y-auto bg-sidebar px-3 py-[18px] shadow-drawer">
            <div className="flex items-start justify-between">
              {brand(false)}
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close menu"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-row text-sidebar-ink hover:bg-sidebar-hover"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            {renderNav({ rail: false, onNavigate: () => setMobileNavOpen(false) })}
            {footer(false)}
          </aside>
        </div>
      )}

      <aside
        className={`hidden shrink-0 flex-col gap-0.5 overflow-y-auto bg-sidebar py-[18px] transition-[width] duration-200 md:flex ${
          collapsed ? 'w-16 px-2' : 'w-60 px-3'
        }`}
      >
        {brand(collapsed)}
        {renderNav({ rail: collapsed })}
        {footer(collapsed)}
      </aside>

      <TopBarContext.Provider value={slots}>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-topbar px-4 py-2 md:px-7">
            <div
              ref={titleRef}
              className="flex min-w-0 items-center [&:has([data-page-title])>[data-default-title]]:hidden"
            >
              <h1 data-default-title className="text-page-title text-ink">
                {currentLabel}
              </h1>
            </div>
            <div
              ref={actionsRef}
              className="flex flex-wrap items-center gap-2"
            />
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-7">
            <div className="mx-auto max-w-[1440px]">
              <Suspense fallback={<p className="text-[14px] text-muted">Loading…</p>}>
                <Outlet />
              </Suspense>
            </div>
          </div>
        </main>
      </TopBarContext.Provider>
    </div>
  )
}
