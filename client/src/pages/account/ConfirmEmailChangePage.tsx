import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Copyright } from '../../components/Copyright'

// The link from the "confirm your new email" message: /confirm-email-change?token=…
// A query keyed by the token, not a mutation in an effect, for the same reason as
// VerifyEmailPage: the token is single use and StrictMode would otherwise send it twice.
// Confirming signs out every session of that account, so this tab's stored session goes too.
export function ConfirmEmailChangePage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { token: session, logout } = useAuth()

  const confirm = useQuery({
    queryKey: ['confirm-email-change', token],
    queryFn: () => api.post<{ ok: true; email: string }>('/auth/confirm-email-change', { token }),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (confirm.isSuccess && session) logout()
  }, [confirm.isSuccess, session, logout])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-surface p-4">
      <div className="flex w-full max-w-[440px] flex-col items-center gap-4 rounded-card bg-surface p-8 text-center shadow-card">
        {!token ? (
          <>
            <span className="material-symbols-outlined !text-[40px] text-error">error</span>
            <h1 className="text-headline-md text-primary">Link is incomplete</h1>
            <p className="text-body-md text-on-surface-variant">Open the link from the email exactly as it was sent.</p>
          </>
        ) : confirm.isPending ? (
          <>
            <span className="material-symbols-outlined animate-spin !text-[40px] text-primary">progress_activity</span>
            <p className="text-body-md text-on-surface-variant">Confirming your new email…</p>
          </>
        ) : confirm.isSuccess ? (
          <>
            <span className="material-symbols-outlined !text-[40px] text-primary">check_circle</span>
            <h1 className="text-headline-md text-primary">Email changed</h1>
            <p className="text-body-md text-on-surface-variant">
              Sign in with <b className="font-semibold">{confirm.data.email}</b> from now on. You were signed out on every device.
            </p>
            <Link to="/login" className="text-label-md text-primary hover:underline">
              Continue to sign in
            </Link>
          </>
        ) : (
          <>
            <span className="material-symbols-outlined !text-[40px] text-error">error</span>
            <h1 className="text-headline-md text-primary">Email not changed</h1>
            <p className="text-body-md text-on-surface-variant">
              {confirm.error instanceof ApiError ? confirm.error.message : 'This link may be invalid or expired.'} You can send a new link from
              My account.
            </p>
            <Link to="/login" className="text-label-md text-primary hover:underline">
              Go to sign in
            </Link>
          </>
        )}
      </div>
      <Copyright />
    </main>
  )
}
