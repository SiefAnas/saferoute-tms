import { useState } from 'react'

// Lightweight hover tooltip for a section's explanation text — used where a page previously
// showed a permanent explanatory paragraph under a heading; the text now only appears on
// hover, keeping the default view shorter. CSS-only positioning (no portal), so this is meant
// for compact one-to-three-sentence copy near where it's anchored, not long-form content.
export function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false)

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        aria-label="More info"
        className="flex h-5 w-5 items-center justify-center rounded-full text-on-surface-variant hover:text-primary"
      >
        <span className="material-symbols-outlined !text-[18px]">info</span>
      </button>
      {show && (
        <span
          role="tooltip"
          className="absolute top-full left-0 z-20 mt-1 w-64 rounded-lg border border-outline-variant bg-surface-container-lowest p-2 text-label-md font-normal text-on-surface-variant shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  )
}
