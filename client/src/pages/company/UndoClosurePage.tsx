import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Copyright } from '../../components/Copyright'

// The undo link from the "account closing" email: /company-closure/undo?token=…
// Public: nobody in a closing company can sign in. A query keyed by the token (not a mutation in
// an effect) so StrictMode can't send the single-use token twice, like VerifyEmailPage.
export function UndoClosurePage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const undo = useQuery({
    queryKey: ['undo-closure', token],
    queryFn: () => api.delete<{ ok: true; company: string }>(`/companies/me/closure?token=${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  })

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-surface p-4">
      <div className="flex w-full max-w-[440px] flex-col items-center gap-4 rounded-card bg-surface p-8 text-center shadow-card">
        {!token ? (
          <>
            <span className="material-symbols-outlined !text-[40px] text-error">error</span>
            <h1 className="text-headline-md text-primary">Link is incomplete</h1>
            <p className="text-body-md text-on-surface-variant">Open the link from the email exactly as it was sent.</p>
          </>
        ) : undo.isPending ? (
          <>
            <span className="material-symbols-outlined animate-spin !text-[40px] text-primary">progress_activity</span>
            <p className="text-body-md text-on-surface-variant">Keeping your account…</p>
          </>
        ) : undo.isSuccess ? (
          <>
            <span className="material-symbols-outlined !text-[40px] text-primary">check_circle</span>
            <h1 className="text-headline-md text-primary">Account kept</h1>
            <p className="text-body-md text-on-surface-variant">
              <b className="font-semibold">{undo.data.company}</b> is no longer closing and nothing was deleted. Everyone can sign in again.
            </p>
            <Link to="/login" className="text-label-md text-primary hover:underline">
              Continue to sign in
            </Link>
          </>
        ) : (
          <>
            <span className="material-symbols-outlined !text-[40px] text-error">error</span>
            <h1 className="text-headline-md text-primary">Could not undo</h1>
            <p className="text-body-md text-on-surface-variant">
              {undo.error instanceof ApiError ? undo.error.message : 'This link may be invalid or expired.'}
            </p>
          </>
        )}
      </div>
      <Copyright />
    </main>
  )
}
