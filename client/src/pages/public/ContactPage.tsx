import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../../lib/api'
import { Photo } from './Photo'

type Topic = 'business' | 'support'

// Public Contact us page (POST /public/contact): business questions are emailed to the admin
// inbox, technical support to the support inbox. Nothing is stored.
export function ContactPage() {
  const [topic, setTopic] = useState<Topic>('business')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post('/public/contact', { topic, full_name: fullName, email, phone, message })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="site-contact">
      <div className="site-contact-intro">
        <p className="site-eyebrow site-rise">Contact us</p>
        <h1 className="site-rise site-rise-2">Let's talk.</h1>
        <p className="site-lead site-rise site-rise-3">Tell us a little about you. We will get back to you soon.</p>
        <div className="site-contact-lines site-rise site-rise-3">
          <span>Business questions: <a href="mailto:admin@safeturns.com">admin@safeturns.com</a></span>
          <span>Technical support: <a href="mailto:support@safeturns.com">support@safeturns.com</a></span>
        </div>
        <Photo size="card" file="contact-desk" alt="A notebook, pen and cup of coffee on a desk" />
      </div>
      <div className="site-form-card site-rise site-rise-2">
        {done ? (
          <div className="site-thanks" role="status">
            <h2>Thank you.</h2>
            <p>We got your message and will reply soon.</p>
          </div>
        ) : (
          <form className="site-form" onSubmit={handleSubmit} aria-label="Contact us">
            <label className="site-field">
              What is this about?
              <select value={topic} onChange={(e) => setTopic(e.target.value as Topic)}>
                <option value="business">Business question</option>
                <option value="support">Technical support</option>
              </select>
            </label>
            <label className="site-field">
              Your name
              <input required maxLength={200} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
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
              Message
              <textarea required maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
            {error && <p className="site-error" role="alert">{error}</p>}
            <div className="site-btn-row">
              <button type="submit" className="site-btn" disabled={submitting}>
                {submitting ? 'Sending...' : 'Send message'}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
