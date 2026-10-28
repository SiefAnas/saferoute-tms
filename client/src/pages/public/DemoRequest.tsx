import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../../lib/api'

type Audience = 'company' | 'school'

// "Book a demo" on the Companies and Schools pages: the button opens the form; the request is
// saved and emailed to the SafeTurns admin inbox (POST /public/demo-request).
export function DemoRequest({ audience }: { audience: Audience }) {
  const [open, setOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [organization, setOrganization] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const orgLabel = audience === 'company' ? 'Company name' : 'School name'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post('/public/demo-request', { audience, full_name: fullName, organization, email, phone, message })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) return <p role="status">Thank you. We received your demo request and will contact you soon.</p>
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Book a demo
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Book a demo">
      <h2>Book a demo</h2>
      <p>
        <label htmlFor="demo-name">Your name</label>
        <input id="demo-name" required maxLength={200} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </p>
      <p>
        <label htmlFor="demo-org">{orgLabel}</label>
        <input id="demo-org" required maxLength={200} autoComplete="organization" value={organization} onChange={(e) => setOrganization(e.target.value)} />
      </p>
      <p>
        <label htmlFor="demo-email">Email</label>
        <input id="demo-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </p>
      <p>
        <label htmlFor="demo-phone">Phone (optional)</label>
        <input id="demo-phone" type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </p>
      <p>
        <label htmlFor="demo-message">Message (optional)</label>
        <textarea id="demo-message" maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />
      </p>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Sending...' : 'Send request'}
      </button>{' '}
      <button type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  )
}
