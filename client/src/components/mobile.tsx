import { createContext, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import { ThemeToggle } from './ThemeToggle'
import { Copyright } from './Copyright'
import { useComingSoon } from './ComingSoon'
import { useAuth } from '../lib/auth'
import { LG_QUERY, MD_QUERY, useMediaQuery } from '../lib/useMediaQuery'
import { TopBarContext, type TopBarSlots } from '../layouts/TopBar'

// Building blocks for the driver (3a) and parent (5b) shells. On phones everything sits inside a
// `.mobile-app` root, so the shared color roles resolve to the mobile palette; on wider screens
// inside `.web-portal` (web palette, see index.css).

// ---- Shell: header + scroll area + optional thumb bar + bottom tabs ----

const ThumbSlotContext = createContext<HTMLElement | null>(null)

export interface MobileTab {
  to: string
  label: string
  icon: string
  end?: boolean
  // V2 tab: shown, but tapping it opens the Coming Soon dialog instead of navigating.
  comingSoon?: string
}

export interface ShellProps {
  hubName: string // sidebar title on wide screens ("Driver", "Parent")
  title: string // "Good morning, Luis"
  sub: ReactNode // date line under the title
  onLogout: () => void
  tabs: MobileTab[]
  children: ReactNode
}

// Driver/parent shell. Phones (below md) get the approved mobile design (3a / 5b) exactly as
// before. Tablets and desktops get a website layout in the admin shell's style (web palette,
// slate sidebar, top bar), so the pages use the width instead of a phone column.
export function MobileShell(props: ShellProps) {
  const wide = useMediaQuery(MD_QUERY)
  return wide ? <WideShell {...props} /> : <PhoneShell {...props} />
}

function PhoneShell({ title, sub, onLogout, tabs, children }: ShellProps) {
  const [thumbSlot, setThumbSlot] = useState<HTMLElement | null>(null)
  const slotRef = useCallback((el: HTMLDivElement | null) => setThumbSlot(el), [])
  const openComingSoon = useComingSoon()
  const header = <MobileHeader title={title} sub={sub} onLogout={onLogout} />
  return (
    <div className="mobile-app min-h-dvh">
      <div className="mx-auto flex h-dvh max-w-[480px] flex-col bg-bg md:border-x md:border-line">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3.5">
          {header}
          <ThumbSlotContext.Provider value={thumbSlot}>
            <Suspense fallback={<p className="px-5 pt-6 text-[14px] text-muted">Loading…</p>}>{children}</Suspense>
          </ThumbSlotContext.Provider>
          <Copyright className="mt-auto pt-6" />
        </div>
        <div ref={slotRef} />
        <nav className="grid shrink-0 border-t border-line bg-surface pt-2 pb-[max(24px,env(safe-area-inset-bottom))]" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((t) =>
            t.comingSoon ? (
              <button
                key={t.to}
                type="button"
                onClick={() => openComingSoon(t.comingSoon)}
                className="flex cursor-pointer flex-col items-center gap-[3px] text-[11px] font-medium text-tab-off"
              >
                <span className="material-symbols-outlined !text-[22px]">{t.icon}</span>
                {t.label}
              </button>
            ) : (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-[3px] text-[11px] font-medium ${isActive ? 'text-tab-on' : 'text-tab-off'}`
              }
            >
              <span className="material-symbols-outlined !text-[22px]">{t.icon}</span>
              {t.label}
            </NavLink>
            ),
          )}
        </nav>
      </div>
    </div>
  )
}

function initials(name: string | undefined) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

// Tablet/desktop shell: the admin layout's look (AdminLayout.tsx) with the tabs as sidebar
// links. `.web-portal` keeps the web palette and gives the mobile-only roles (shift switch,
// call button, pay calendar) web values in both themes. The page's action area (ThumbBar)
// becomes a bar at the bottom of the content.
//
// Bug fix (bug-fixes, 2026-09-24): on tablets (md to lg) the 240px sidebar stayed on screen,
// also while a student / vehicle detail was open, leaving the page ~530px. Below lg the sidebar
// is now a slide-out menu (menu button in the top bar), closed by default and closed again on
// navigation, a tap outside or Escape. Wide desktops keep the fixed sidebar.
function WideShell({ hubName, title, sub, onLogout, tabs, children }: ShellProps) {
  const desktop = useMediaQuery(LG_QUERY)
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setMenuOpen(false), [location.pathname])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])
  const showSidebar = desktop || menuOpen
  const [thumbSlot, setThumbSlot] = useState<HTMLElement | null>(null)
  const slotRef = useCallback((el: HTMLDivElement | null) => setThumbSlot(el), [])
  const openComingSoon = useComingSoon()
  const { user } = useAuth()
  // Same top-bar slots as the admin shell (layouts/TopBar.tsx): a page can set its own title and
  // actions with <PageTopBar>; otherwise the bar shows the greeting and the date line.
  const [slots, setSlots] = useState<TopBarSlots>({ title: null, actions: null })
  const titleRef = useCallback((el: HTMLDivElement | null) => setSlots((s) => (s.title === el ? s : { ...s, title: el })), [])
  const actionsRef = useCallback((el: HTMLDivElement | null) => setSlots((s) => (s.actions === el ? s : { ...s, actions: el })), [])
  const itemClass = (active: boolean) =>
    `flex h-[38px] w-full cursor-pointer items-center gap-3 rounded-btn px-2.5 text-[14px] transition-colors ${
      active ? 'bg-amber font-semibold text-on-amber' : 'text-sidebar-ink hover:bg-sidebar-hover'
    }`
  return (
    <div className="web-portal flex h-screen bg-bg text-ink">
      {!desktop && menuOpen && <div className="fixed inset-0 z-40 bg-scrim" onClick={() => setMenuOpen(false)} aria-hidden />}
      {showSidebar && (
      <aside
        aria-label="Menu"
        className={`flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto bg-sidebar px-3 py-[18px] ${desktop ? '' : 'fixed inset-y-0 left-0 z-50 shadow-drawer'}`}
      >
        <div className="flex items-center gap-2.5 px-2 pb-5">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-btn bg-amber">
            <span className="material-symbols-outlined !text-[20px] text-on-amber">local_shipping</span>
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-display text-[15px] font-bold text-sidebar-strong">SafeRoute</span>
            <span className="truncate text-[12px] text-sidebar-icon">{hubName}</span>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {tabs.map((t) =>
            t.comingSoon ? (
              <button key={t.to} type="button" onClick={() => openComingSoon(t.comingSoon)} className={itemClass(false)}>
                <span className="material-symbols-outlined !text-[20px] text-sidebar-icon">{t.icon}</span>
                <span className="truncate">{t.label}</span>
                <span className="ml-auto rounded-[9px] bg-sidebar-chip px-[7px] py-0.5 text-[11px] font-semibold text-sidebar-ink">Soon</span>
              </button>
            ) : (
              <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => itemClass(isActive)}>
                {({ isActive }) => (
                  <>
                    <span className={`material-symbols-outlined !text-[20px] ${isActive ? '' : 'text-sidebar-icon'}`}>{t.icon}</span>
                    <span className="truncate">{t.label}</span>
                  </>
                )}
              </NavLink>
            ),
          )}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 border-t border-sidebar-line px-2.5 pt-3">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-sidebar-chip text-[11px] font-bold text-sidebar-strong">
            {initials(user?.full_name)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-semibold text-sidebar-strong">{user?.full_name}</span>
            <span className="truncate text-[12px] text-sidebar-icon">{hubName}</span>
          </div>
          <ThemeToggle variant="sidebar" />
          <button
            type="button"
            onClick={onLogout}
            aria-label="Log out"
            title="Log out"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-row text-sidebar-icon hover:bg-sidebar-hover hover:text-sidebar-strong"
          >
            <span className="material-symbols-outlined !text-[20px]">logout</span>
          </button>
        </div>
      </aside>
      )}

      <TopBarContext.Provider value={slots}>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-topbar px-7 py-2">
            {!desktop && (
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                aria-label="Open menu"
                aria-expanded={menuOpen}
                className="-ml-2 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-row text-ink hover:bg-surface-2"
              >
                <span className="material-symbols-outlined">menu</span>
              </button>
            )}
            <div ref={titleRef} className="flex min-w-0 flex-1 items-center [&:has([data-page-title])>[data-default-title]]:hidden">
              <div data-default-title className="flex min-w-0 flex-col gap-0.5">
                <h1 className="truncate text-page-title text-ink">{title}</h1>
                <span className="truncate text-[13px] text-muted">{sub}</span>
              </div>
            </div>
            <div ref={actionsRef} className="flex flex-wrap items-center gap-2" />
          </div>
          <div className="flex-1 overflow-y-auto px-7 py-6">
            <div className="mx-auto max-w-[1440px]">
              <ThumbSlotContext.Provider value={thumbSlot}>
                <Suspense fallback={<p className="text-[14px] text-muted">Loading…</p>}>{children}</Suspense>
              </ThumbSlotContext.Provider>
              <Copyright className="mt-6" />
            </div>
          </div>
          <div ref={slotRef} className="shrink-0 empty:hidden" />
        </main>
      </TopBarContext.Provider>
    </div>
  )
}

// The screen's fixed action area: right above the tab bar on phones, a bar along the bottom of
// the content on wider screens (portaled out of the scroll area either way).
export function ThumbBar({ children }: { children: ReactNode }) {
  const slot = useContext(ThumbSlotContext)
  const wide = useMediaQuery(MD_QUERY)
  if (!slot) return null
  return createPortal(
    wide ? (
      <div className="border-t border-line bg-surface px-7 py-3">
        <div className="mx-auto flex max-w-[1200px] justify-end">
          <div className="flex w-full max-w-[520px] flex-col gap-2.5">{children}</div>
        </div>
      </div>
    ) : (
      <div className="flex flex-col gap-2.5 border-t border-line bg-surface px-4 py-3">{children}</div>
    ),
    slot,
  )
}

// "Good morning, Luis" + a sub line + round header buttons (theme toggle, logout).
export function MobileHeader({ title, sub, onLogout }: { title: string; sub: ReactNode; onLogout: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5">
      <div className="flex min-w-0 flex-col gap-[3px]">
        <h1 className="text-m-greeting text-ink">{title}</h1>
        <span className="text-[13px] text-muted">{sub}</span>
      </div>
      <div className="flex shrink-0 gap-2">
        <ThemeToggle variant="mobile" />
        <button
          type="button"
          onClick={onLogout}
          aria-label="Log out"
          title="Log out"
          className="flex h-[38px] w-[38px] cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-muted"
        >
          <span className="material-symbols-outlined !text-[20px]">logout</span>
        </button>
      </div>
    </div>
  )
}

export function SectionHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-5 pt-4 pb-3">
      <h2 className="text-m-section text-ink">{title}</h2>
      {aside && <span className="text-[13px] text-muted">{aside}</span>}
    </div>
  )
}

// ---- Overlays ----

function useEscape(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

// Bottom sheet: max 88% tall, 20px top corners, grabber, internal scroll.
export function BottomSheet({ onClose, header, children, label }: { onClose: () => void; header: ReactNode; children: ReactNode; label: string }) {
  useEscape(onClose)
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-scrim" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88%] max-w-[480px] flex-col overflow-hidden rounded-t-sheet bg-surface shadow-sheet">
        <div className="flex justify-center pt-2 pb-0.5">
          <span className="h-1 w-9 rounded-full bg-outline" />
        </div>
        {header}
        <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-7">{children}</div>
      </div>
    </div>
  )
}

// Confirm card: floats 16px from the edges, above the tab bar ("Switch to Afternoon?").
export function ConfirmCard({
  title,
  body,
  cancelLabel = 'Cancel',
  confirmLabel,
  onCancel,
  onConfirm,
  busy = false,
}: {
  title: string
  body: ReactNode
  cancelLabel?: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
  busy?: boolean
}) {
  useEscape(onCancel)
  return (
    <div className="fixed inset-0 z-50" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-scrim" onClick={onCancel} />
      <div className="absolute inset-x-4 bottom-6 mx-auto flex max-w-[448px] flex-col gap-3 rounded-[16px] bg-surface p-[18px] shadow-sheet md:top-1/2 md:bottom-auto md:-translate-y-1/2">
        <span className="text-[17px] font-semibold text-ink">{title}</span>
        <div className="text-[14px] leading-normal text-muted">{body}</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-[46px] cursor-pointer rounded-m border border-outline bg-outline-bg text-[14px] font-medium text-ink"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="h-[46px] cursor-pointer rounded-m bg-action text-[14px] font-semibold text-on-action disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// A call button: `tel:` link, filled for the primary contact, outline for the rest.
export function CallButton({ phone, primary = false, label }: { phone: string; primary?: boolean; label: string }) {
  return (
    <a
      href={`tel:${phone.replace(/[^0-9+]/g, '')}`}
      aria-label={label}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
        primary ? 'bg-call-bg text-on-call' : 'border border-outline text-ink'
      }`}
    >
      <span className="material-symbols-outlined !text-[20px]">call</span>
    </a>
  )
}
