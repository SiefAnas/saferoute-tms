import { useCallback, useEffect, useRef, useState } from 'react'

// Bottom-center confirmation toast (README 3b "Toast"): slate, 10px radius, green check,
// gone after ~2.6s.
export function useToast(durationMs = 2600) {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(
    (text: string) => {
      setMessage(text)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setMessage(null), durationMs)
    },
    [durationMs],
  )

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const node = message ? (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-m bg-toast px-4 py-3 text-[14px] font-medium text-white shadow-toast"
    >
      <span className="material-symbols-outlined !text-[20px] text-toast-icon">check_circle</span>
      {message}
    </div>
  ) : null

  return { show, node }
}
