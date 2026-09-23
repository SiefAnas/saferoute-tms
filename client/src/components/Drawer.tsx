import { useEffect, type ReactNode } from 'react'

// Right-side details drawer (README 3b "Breakdown drawer" and 5a "Row click opens the details
// drawer"): scrim, slate header with an amber eyebrow label, scrolling body, pinned footer.
export function Drawer({
  eyebrow,
  title,
  subtitle,
  headerExtra,
  footer,
  width = 400,
  onClose,
  children,
}: {
  eyebrow: string
  title: ReactNode
  subtitle?: ReactNode
  headerExtra?: ReactNode
  footer?: ReactNode
  width?: 400 | 420
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-scrim" onClick={onClose} />
      <div
        className="absolute top-0 right-0 bottom-0 flex w-full flex-col bg-surface shadow-drawer"
        style={{ maxWidth: width }}
      >
        <div className="flex flex-col gap-3 bg-drawer-head px-[22px] pt-[18px] pb-5 text-hero-ink">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold tracking-[.06em] text-amber-soft">{eyebrow}</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-row bg-sidebar-chip text-sidebar-strong hover:opacity-85"
            >
              <span className="material-symbols-outlined !text-[20px]">close</span>
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-display text-[22px] leading-7 font-bold">{title}</span>
            {subtitle && <span className="text-[13px] text-hero-muted">{subtitle}</span>}
          </div>
          {headerExtra}
        </div>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-[22px] py-[18px]">{children}</div>
        {footer && <div className="border-t border-divider px-[22px] py-4">{footer}</div>}
      </div>
    </div>
  )
}

// Key/value rows for a details drawer: 130px label column.
export function DetailRows({ rows }: { rows: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="flex flex-col">
      {rows.map((r) => (
        <div key={r.k} className="grid grid-cols-[130px_1fr] gap-3 border-b border-divider py-2.5 text-[14px]">
          <dt className="text-muted">{r.k}</dt>
          <dd className="min-w-0 font-medium break-words text-ink">{r.v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="font-display text-[15px] font-bold text-ink">{title}</h3>
      {children}
    </section>
  )
}
