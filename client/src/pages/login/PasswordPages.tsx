import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { ROLE_HOME } from '../../lib/roleHome'
import { Button } from '../../components/Button'
import { Field, Input } from '../../components/Input'
import { PasswordField } from '../../components/PasswordField'
import { AuthScreen } from './AuthScreen'
import type { LoginResponse } from '../../types/api'

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-lg bg-error-container px-4 py-2 text-body-md text-on-error-container">
      {error}
    </p>
  )
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

// First sign-in with a temporary password (the admin created or reset the account): the user
// must choose their own password before anything else. ProtectedRoute sends them here.
export function SetPasswordPage() {
  const { user, token, setSession, logout } = useAuth()
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (!token || !user) return <Navigate to="/login" replace />
  if (!user.must_change_password) return <Navigate to={ROLE_HOME[user.role]} replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (next !== confirm) return setError("The new passwords don't match.")
    setSaving(true)
    try {
      const res = await api.post<LoginResponse>('/auth/change-password', { currentPassword: current, newPassword: next })
      setSession(res)
      navigate(ROLE_HOME[res.user.role], { replace: true })
    } catch (err) {
      setError(errorText(err, 'Could not save your password. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthScreen title="Choose your password" subtitle={`Welcome, ${user.full_name}. Replace the temporary password you were given.`}>
      <form className="flex w-full flex-col gap-5" onSubmit={handleSubmit}>
        <Field label="Temporary password">
          <Input type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <PasswordField label="New password" required value={next} onChange={setNext} />
        <Field label="Confirm new password">
          <Input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <ErrorLine error={error} />
        <Button type="submit" size="lg" disabled={saving} className="w-full">
          {saving ? 'Saving…' : 'Save and continue'}
        </Button>
      </form>
      <button type="button" onClick={logout} className="text-label-md text-primary hover:underline">
        Sign out
      </button>
    </AuthScreen>
  )
}

// "Forgot password?": always the same confirmation, whether or not the email has an account.
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSending(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (err) {
      setError(errorText(err, 'Something went wrong. Please try again.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <AuthScreen title="Reset your password" subtitle="We'll email you a link to choose a new password.">
      {sent ? (
        <div className="flex w-full flex-col gap-3 text-body-md text-on-surface">
          <p role="status">
            If an account uses <b className="font-semibold">{email}</b>, we sent it a link to reset the password. The link works once, for
            60 minutes.
          </p>
          <p className="text-muted">No email? Ask your company or school administrator to reset your password for you.</p>
        </div>
      ) : (
        <form className="flex w-full flex-col gap-5" onSubmit={handleSubmit}>
          <Field label="Email address">
            <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@saferoute.com" />
          </Field>
          <ErrorLine error={error} />
          <Button type="submit" size="lg" disabled={sending} className="w-full">
            {sending ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
      <Link to="/login" className="text-label-md text-primary hover:underline">
        Back to sign in
      </Link>
    </AuthScreen>
  )
}

// The page the emailed link opens: /reset-password?token=…
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(token ? null : 'This reset link is missing its code. Ask for a new link.')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (next !== confirm) return setError("The new passwords don't match.")
    setSaving(true)
    try {
      await api.post('/auth/reset-password', { token, newPassword: next })
      setDone(true)
    } catch (err) {
      setError(errorText(err, 'Could not reset your password. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthScreen title="Choose a new password" subtitle="After this you'll be signed out everywhere and can sign in with it.">
      {done ? (
        <p role="status" className="w-full text-body-md text-on-surface">
          Your password is changed. Sign in with your new password.
        </p>
      ) : (
        <form className="flex w-full flex-col gap-5" onSubmit={handleSubmit}>
          <PasswordField label="New password" required value={next} onChange={setNext} />
          <Field label="Confirm new password">
            <Input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <ErrorLine error={error} />
          <Button type="submit" size="lg" disabled={saving || !token} className="w-full">
            {saving ? 'Saving…' : 'Save new password'}
          </Button>
        </form>
      )}
      <div className="flex gap-4">
        <Link to="/login" className="text-label-md text-primary hover:underline">
          Sign in
        </Link>
        {!done && (
          <Link to="/forgot-password" className="text-label-md text-primary hover:underline">
            Get a new link
          </Link>
        )}
      </div>
    </AuthScreen>
  )
}
