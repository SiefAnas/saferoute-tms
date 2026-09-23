import { createContext, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NavLink } from 'react-router-dom'
import { ThemeToggle } from './ThemeToggle'

// Building blocks for the mobile shells (driver 3a, parent 5b). Everything here sits inside a
// `.mobile-app` root, so the shared color roles already resolve to the mobile palette.

// ---- Shell: header + scroll area + optional thumb bar + bottom tabs ----

const ThumbSlotContext = createContext<HTMLElement | null>(null)

export interface MobileTab {
  to: string
  label: string
  icon: string
  end?: boolean
}

export function MobileShell({ header, tabs, children }: { header: ReactNode; tabs: MobileTab[]; children: ReactNode }) {
  const [thumbSlot, setThumbSlot] = useState<HTMLElement | null>(null)
  const slotRef = useCallback((el: HTMLDivElement | null) => setThumbSlot(el), [])
  return (
    <div className="mobile-app min-h-dvh">
      <div className="mx-auto flex h-dvh max-w-[480px] flex-col bg-bg md:border-x md:border-line">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3.5">
          {header}
          <ThumbSlotContext.Provider value={thumbSlot}>
            <Suspense fallback={<p className="px-5 pt-6 text-[14px] text-muted">Loading…</p>}>{children}</Suspense>
          </ThumbSlotContext.Provider>
        </div>
        <div ref={slotRef} />
        <nav className="grid shrink-0 border-t border-line bg-surface pt-2 pb-[max(24px,env(safe-area-inset-bottom))]" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((t) => (
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
          ))}
        </nav>
      </div>
    </div>
  )
}

// The screen's fixed action area, right above the tab bar (portaled out of the scroll area).
export function ThumbBar({ children }: { children: ReactNode }) {
  const slot = useContext(ThumbSlotContext)
  if (!slot) return null
  return createPortal(
    <div className="flex flex-col gap-2.5 border-t border-line bg-surface px-4 py-3">{children}</div>,
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
      <div className="absolute inset-x-4 bottom-6 mx-auto flex max-w-[448px] flex-col gap-3 rounded-[16px] bg-surface p-[18px] shadow-sheet">
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
