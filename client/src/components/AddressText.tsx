import { useEffect, useState } from 'react'

// An address the user can copy: click (or tap) copies it and the line shows "Address copied"
// for a moment in place. Same behavior as the mobile app. Opening a maps app is V2.
export function AddressText({ address, className = 'text-[13px] text-muted' }: { address: string; className?: string }) {
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(null), 1800)
    return () => clearTimeout(t)
  }, [copied])
  async function copy() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied('ok')
    } catch {
      setCopied('failed') // clipboard blocked (e.g. not https): the address is still there to select
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy address"
      aria-label={`${address}. Copy the address.`}
      className={`cursor-pointer text-left underline decoration-dotted underline-offset-2 hover:text-ink ${className}`}
    >
      {copied === 'ok' ? (
        <span role="status" className="inline-flex items-center gap-1 font-medium text-success-fg no-underline">
          <span className="material-symbols-outlined !text-[16px]">check_circle</span>
          Address copied
        </span>
      ) : copied === 'failed' ? (
        <span role="status">{address} (select to copy)</span>
      ) : (
        address
      )}
    </button>
  )
}
