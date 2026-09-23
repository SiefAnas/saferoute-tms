import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
}

// Centered dialog for create/edit forms. Restyled to the refresh tokens: surface card, 14px
// radius, card-title heading, theme-aware scrim. Row details use Drawer instead.
export function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-y-auto rounded-card bg-surface text-ink shadow-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-divider px-6 py-4">
          <h2 className="text-card-title">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-row text-muted hover:bg-surface-2"
          >
            <span className="material-symbols-outlined !text-[20px]">close</span>
          </button>
        </div>
        <div className="flex flex-col gap-4 p-6">{children}</div>
      </div>
    </div>
  )
}
