import { useEffect, useRef, useState } from 'react'

// Global click-to-call/click-to-email + click-to-copy (§7 item 5) — one component wraps
// every phone/email display in the app so the interaction (and its styling) stays
// consistent instead of each page hand-rolling a tel:/mailto: link.
interface ContactLinkProps {
  type: 'phone' | 'email'
  value: string | null | undefined
  className?: string
}

export function ContactLink({ type, value, className = '' }: ContactLinkProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!value) return <span className={className}>—</span>

  async function copy() {
    try {
      await navigator.clipboard.writeText(value as string)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — silently no-op, the menu stays
      // open so the user can select/copy the text themselves.
    }
  }

  const actionLabel = type === 'phone' ? 'Call' : 'Email'
  const actionHref = type === 'phone' ? `tel:${value}` : `mailto:${value}`
  const actionIcon = type === 'phone' ? 'call' : 'mail'

  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`text-left underline decoration-dotted underline-offset-2 hover:text-primary ${className}`}
      >
        {value}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 flex min-w-[140px] flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest shadow-lg">
          <a
            href={actionHref}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-body-md text-on-surface hover:bg-surface-container"
          >
            <span className="material-symbols-outlined !text-[18px] text-primary">{actionIcon}</span>
            {actionLabel}
          </a>
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-2 px-3 py-2 text-left text-body-md text-on-surface hover:bg-surface-container"
          >
            <span className="material-symbols-outlined !text-[18px] text-primary">content_copy</span>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
    </span>
  )
}
