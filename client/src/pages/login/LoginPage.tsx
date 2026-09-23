import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { ROLE_HOME } from '../../lib/roleHome'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { ApiError } from '../../lib/api'
import { AuthScreen } from './AuthScreen'

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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const user = await login(email, password)
      // On a temporary password (new or reset account): choose their own first.
      navigate(user.must_change_password ? '/set-password' : ROLE_HOME[user.role], { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthScreen title="SafeRoute Logistics" subtitle="Sign in to your account">
      <form className="flex w-full flex-col gap-6" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <label className="px-1 text-[12px] font-semibold text-muted" htmlFor="email">
            Email address
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
          <label className="px-1 text-[12px] font-semibold text-muted" htmlFor="password">
            Password
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
          <Link to="/forgot-password" className="text-label-md text-secondary hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" size="lg" disabled={submitting} className="w-full">
          {submitting ? (
            <>
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              Signing in...
            </>
          ) : (
            <>
              Sign in
              <span className="material-symbols-outlined">arrow_forward</span>
            </>
          )}
        </Button>
      </form>

      <Link to="/register" className="text-label-md text-primary hover:underline">
        New here? Register your company or school
      </Link>
    </AuthScreen>
  )
}
