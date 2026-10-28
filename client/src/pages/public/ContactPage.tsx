import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../../lib/api'

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
    <>
      <h1>Let's talk.</h1>
      <p>Tell us a little about you. We will get back to you soon.</p>
      {done ? (
        <p role="status">Thank you. We got your message and will reply soon.</p>
      ) : (
        <form onSubmit={handleSubmit} aria-label="Contact us">
          <p>
            <label htmlFor="contact-topic">What is this about?</label>
            <select id="contact-topic" value={topic} onChange={(e) => setTopic(e.target.value as Topic)}>
              <option value="business">Business question</option>
              <option value="support">Technical support</option>
            </select>
          </p>
          <p>
            <label htmlFor="contact-name">Your name</label>
            <input id="contact-name" required maxLength={200} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </p>
          <p>
            <label htmlFor="contact-email">Email</label>
            <input id="contact-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </p>
          <p>
            <label htmlFor="contact-phone">Phone (optional)</label>
            <input id="contact-phone" type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </p>
          <p>
            <label htmlFor="contact-message">Message</label>
            <textarea id="contact-message" required maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </p>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Sending...' : 'Send message'}
          </button>
        </form>
      )}
    </>
  )
}
