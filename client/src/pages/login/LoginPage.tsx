import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { ROLE_HOME } from '../../lib/roleHome'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { ApiError } from '../../lib/api'

// "I forgot my password" self-report, shown only for the 3 roles that can't self-serve a
// reset (task: driver/parent/school_staff — company_admin/school_admin aren't offered this).
// No real reset flow exists — this is deliberately just a static contact message.
const FORGOT_PASSWORD_ROLES = [
  { key: 'driver', label: 'Driver', message: 'Please contact your company administrator to reset your password.' },
  { key: 'parent', label: 'Parent', message: 'Please contact your company administrator to reset your password.' },
  { key: 'school_staff', label: 'School Staff', message: 'Please contact your school administrator to reset your password.' },
] as const

// ASSUMPTION (flagged for confirmation): this is one shared login page for all 4 roles
// (§5.1) — the app deliberately does not know which role a visitor is until AFTER they
// authenticate, so "forgot password, shown only for driver/parent/staff" can't be
// conditioned on the visitor's real role pre-login. Resolved by asking them to self-report
// which of those 3 they are, then showing that role's static message — no real identity
// check needed since no real reset action happens either way.
function ForgotPasswordPanel({ onClose }: { onClose: () => void }) {
  const [picked, setPicked] = useState<(typeof FORGOT_PASSWORD_ROLES)[number] | null>(null)
  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-outline-variant bg-surface-container-low p-4">
      {!picked ? (
        <>
          <p className="text-body-md text-on-surface-variant">I am a…</p>
          <div className="flex flex-wrap gap-2">
            {FORGOT_PASSWORD_ROLES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setPicked(r)}
                className="rounded-full border border-outline px-4 py-1.5 text-label-md text-on-surface hover:bg-surface-container"
              >
                {r.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p role="status" className="text-body-md text-on-surface">
          {picked.message}
        </p>
      )}
      <button type="button" onClick={onClose} className="self-start text-label-md text-secondary hover:underline">
        Close
      </button>
    </div>
  )
}

// One shared login page for all 4 roles (§5.1) — role determines the post-login
// destination, not which page/URL the user starts at. Visual design ported from the
// Stitch "Driver Login" mockup, generalized since this screen isn't driver-only.
export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showForgot, setShowForgot] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const user = await login(email, password)
      navigate(ROLE_HOME[user.role], { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0F172A] p-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-20">
        <div className="absolute top-[-10%] left-[-10%] h-[40%] w-[40%] rounded-full bg-primary-container blur-[120px]" />
        <div className="absolute right-[-10%] bottom-[-10%] h-[30%] w-[30%] rounded-full bg-secondary-container blur-[100px]" />
      </div>

      <div className="relative z-10 flex w-full max-w-[440px] flex-col items-center gap-8 rounded-xl border border-outline-variant bg-white p-8">
        <div className="flex flex-col items-center gap-2">
          <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-lg bg-primary-container">
            <span className="material-symbols-outlined !text-[40px] text-on-primary-container">route</span>
          </div>
          <h1 className="text-headline-md tracking-tight text-primary">SafeRoute Logistics</h1>
          <p className="text-label-md tracking-widest text-secondary uppercase">Sign in to your account</p>
        </div>

        <form className="flex w-full flex-col gap-6" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <label className="px-1 text-label-md text-on-surface-variant" htmlFor="email">
              EMAIL ADDRESS
            </label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@saferoute.com"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="px-1 text-label-md text-on-surface-variant" htmlFor="password">
              PASSWORD
            </label>
            <div className="relative flex items-center">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-4 text-outline hover:text-secondary"
              >
                <span className="material-symbols-outlined">{showPassword ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-error-container px-4 py-2 text-body-md text-on-error-container">
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowForgot((v) => !v)}
              className="text-label-md text-secondary hover:underline"
            >
              Forgot password?
            </button>
          </div>
          {showForgot && <ForgotPasswordPanel onClose={() => setShowForgot(false)} />}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? (
              <>
                <span className="material-symbols-outlined animate-spin">progress_activity</span>
                Signing in...
              </>
            ) : (
              <>
                Sign In
                <span className="material-symbols-outlined">arrow_forward</span>
              </>
            )}
          </Button>
        </form>

        <Link to="/register" className="text-label-md text-primary hover:underline">
          New here? Register your company or school
        </Link>
      </div>
    </main>
  )
}
