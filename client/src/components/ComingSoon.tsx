import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Button } from './Button'

// One shared "coming soon" pattern for V2 features (see V2_ROADMAP.md). The design keeps these
// buttons and cards in place; instead of fake data they show this. Two forms:
//   - useComingSoon().open('Live map')  -> a small dialog with an OK button
//   - <ComingSoonCard title="Live map" /> -> an in-place state for a card we have no data for
// Colors come from the theme tokens, so it looks right in light, dark and the mobile shells.

const ComingSoonContext = createContext<(feature?: string) => void>(() => {})

export function ComingSoonProvider({ children }: { children: ReactNode }) {
  const [feature, setFeature] = useState<string | null | undefined>(undefined)
  const open = useCallback((f?: string) => setFeature(f ?? null), [])
  const close = useCallback(() => setFeature(undefined), [])

  useEffect(() => {
    if (feature === undefined) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [feature, close])

  return (
    <ComingSoonContext.Provider value={open}>
      {children}
      {feature !== undefined && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-scrim p-4" onClick={close}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="coming-soon-title"
            className="flex w-full max-w-[22rem] flex-col items-center gap-3 rounded-card bg-surface p-6 text-center text-ink shadow-drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-info-bg text-info-fg">
              <span className="material-symbols-outlined !text-[24px]">rocket_launch</span>
            </span>
            <p id="coming-soon-title" className="text-[16px] font-semibold">
              {feature ? `${feature} is coming soon` : 'Coming soon'}
            </p>
            <p className="text-[14px] text-muted">This feature is coming soon.</p>
            <Button className="mt-1 w-full" onClick={close} autoFocus>
              OK
            </Button>
          </div>
        </div>
      )}
    </ComingSoonContext.Provider>
  )
}

export function useComingSoon() {
  return useContext(ComingSoonContext)
}

// In-place state for a card whose data doesn't exist yet. Clicking it opens the dialog too.
export function ComingSoonCard({ title, body, className = '' }: { title: string; body?: string; className?: string }) {
  const open = useComingSoon()
  return (
    <button
      type="button"
      onClick={() => open(title)}
      className={`flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-m border border-dashed border-line bg-empty px-5 py-6 text-center hover:bg-surface-2 ${className}`}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-info-bg text-info-fg">
        <span className="material-symbols-outlined !text-[20px]">rocket_launch</span>
      </span>
      <span className="text-[14px] font-semibold text-ink">{title}: coming soon</span>
      {body && <span className="max-w-[24rem] text-[12px] text-muted">{body}</span>}
    </button>
  )
}

// Small inline pill for a single value we can't show yet ("Late / On time").
export function ComingSoonPill({ feature }: { feature: string }) {
  const open = useComingSoon()
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        open(feature)
      }}
      className="inline-flex cursor-pointer items-center gap-1 rounded-pill bg-info-bg px-2 py-0.5 text-[11px] font-semibold text-info-fg"
    >
      <span className="material-symbols-outlined !text-[13px]">rocket_launch</span>
      Soon
    </button>
  )
}
