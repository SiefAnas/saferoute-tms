import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'

type Audience = 'company' | 'school'

// "Book a demo" on the Companies and Schools pages: the button opens the form; the request is
// saved and emailed to the SafeTurns admin inbox (POST /public/demo-request). Book a demo buttons
// on other pages link here with #demo, which opens the form straight away.
export function DemoRequest({ audience }: { audience: Audience }) {
  const { hash } = useLocation()
  const [open, setOpen] = useState(hash === '#demo')
  const [fullName, setFullName] = useState('')
  const [organization, setOrganization] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (hash === '#demo') setOpen(true)
  }, [hash])
  useEffect(() => {
    if (open) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [open])

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

  if (!open) {
    return (
      <div className="site-btn-row">
        <button type="button" className="site-btn" onClick={() => setOpen(true)}>
          Book a demo
        </button>
      </div>
    )
  }

  return (
    <div id="demo" ref={formRef} className="site-form-card site-demo">
      {done ? (
        <div className="site-thanks" role="status">
          <h2>Thank you.</h2>
          <p>We received your demo request and will contact you soon.</p>
        </div>
      ) : (
        <form className="site-form" onSubmit={handleSubmit} aria-label="Book a demo">
          <h2>Book a demo</h2>
          <label className="site-field">
            Your name
            <input required maxLength={200} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>
          <label className="site-field">
            {orgLabel}
            <input required maxLength={200} autoComplete="organization" value={organization} onChange={(e) => setOrganization(e.target.value)} />
          </label>
          <label className="site-field">
            Email
            <input type="email" required maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="site-field">
            Phone (optional)
            <input type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="site-field">
            Message (optional)
            <textarea maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          {error && <p className="site-error" role="alert">{error}</p>}
          <div className="site-btn-row">
            <button type="submit" className="site-btn" disabled={submitting}>
              {submitting ? 'Sending...' : 'Send request'}
            </button>
            <button type="button" className="site-btn site-btn-outline" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
