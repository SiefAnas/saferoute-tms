import { useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

// Shown once after an admin creates an account or resets its password: the server generates a
// temporary password and never shows it again. The admin hands it over (read it out, text it);
// the user must choose their own password the first time they sign in.
export function TemporaryPasswordDialog({
  name,
  email,
  password,
  reset = false,
  onClose,
}: {
  name: string
  email: string
  password: string
  reset?: boolean
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
    } catch {
      setCopied(false) // clipboard blocked: the password is on screen to copy by hand
    }
  }
  return (
    <Modal title={reset ? `New temporary password for ${name}` : `${name} can sign in now`} onClose={onClose}>
      <p className="text-[14px] text-muted">
        Give {name} this temporary password. They sign in with <b className="font-semibold text-ink">{email}</b> and choose their own
        password right away.{reset ? ' Their old password and any open sessions no longer work.' : ''}
      </p>
      <div className="flex items-center justify-between gap-3 rounded-btn border border-line bg-surface-2 px-4 py-3">
        <code className="font-mono text-[18px] font-semibold tracking-wide text-ink select-all">{password}</code>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          <span className="material-symbols-outlined !text-[18px]">{copied ? 'check' : 'content_copy'}</span>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="rounded-row bg-caution-bg px-3 py-2 text-[13px] text-caution-fg">
        This password is shown only now. If it gets lost, use Reset password to make a new one.
      </p>
      <div className="flex justify-end">
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  )
}
