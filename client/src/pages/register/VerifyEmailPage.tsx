import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import type { VerifyEmailResponse } from '../../types/api'

// The real production entry point: a claimant clicks the verification link the dev
// mailer "sent" (server/src/mail/mailer.js), landing here with ?token=... in the URL.
// Finalizes the claim (pending_claim -> claimed) per §5.3.
//
// Modeled as a useQuery keyed by the token, NOT a useMutation fired from a useEffect.
// The token is single-use (consumed server-side on first successful verify), so a
// duplicate real request would make the legitimate one look "reused". A mutation fired
// imperatively inside an effect is exactly the pattern React Query's own docs warn about
// under StrictMode's dev-only double-invoke: confirmed live that it left the UI stuck on
// "Verifying..." forever even though the request had already succeeded (the effect's
// cleanup/re-run cycle unsubscribed before the in-flight promise's resolution was
// delivered). A query keyed by `token` is deduplicated by the query cache itself, which is
// exactly what queries are built to do safely under StrictMode.
export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [resendEmail, setResendEmail] = useState('')

  const verify = useQuery({
    queryKey: ['verify-email', token],
    queryFn: () => api.post<VerifyEmailResponse>('/auth/verify-email', { token }),
    enabled: Boolean(token),
    retry: false, // an invalid/expired/reused token is permanent, not transient
    staleTime: Infinity,
  })

  const resend = useMutation({
    mutationFn: () => api.post<{ ok: true }>('/auth/resend-verification', { email: resendEmail }),
  })

  function handleResend(e: FormEvent) {
    e.preventDefault()
    resend.mutate()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className="flex w-full max-w-[440px] flex-col items-center gap-4 rounded-xl border border-outline-variant bg-white p-8 text-center">
        {!token ? (
          <>
            <span className="material-symbols-outlined !text-[40px] text-error">error</span>
            <h1 className="text-headline-md text-primary">Missing verification token</h1>
            <p className="text-body-md text-on-surface-variant">
              This link is missing its verification token. Use the link from your verification email.
            </p>
          </>
        ) : verify.isPending ? (
          <>
            <span className="material-symbols-outlined animate-spin !text-[40px] text-primary">progress_activity</span>
            <p className="text-body-md text-on-surface-variant">Verifying your email…</p>
          </>
        ) : verify.isSuccess ? (
          <>
            <span className="material-symbols-outlined !text-[40px] text-primary">check_circle</span>
            <h1 className="text-headline-md text-primary">Email verified</h1>
            <p className="text-body-md text-on-surface-variant">
              {verify.data.claimFinalized
                ? 'Your claim is confirmed and your account is now active.'
                : 'Your email is confirmed.'}
            </p>
            <Link to="/login" className="text-label-md text-primary hover:underline">
              Continue to sign in
            </Link>
          </>
        ) : (
          <>
            <span className="material-symbols-outlined !text-[40px] text-error">error</span>
            <h1 className="text-headline-md text-primary">Verification failed</h1>
            <p className="text-body-md text-on-surface-variant">
              {verify.error instanceof ApiError ? verify.error.message : 'This link may be invalid or expired.'}
            </p>

            <form className="flex w-full flex-col gap-3 pt-2" onSubmit={handleResend}>
              <label className="text-left text-label-md text-on-surface-variant" htmlFor="resend-email">
                Resend verification link
              </label>
              <Input
                id="resend-email"
                type="email"
                required
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <Button type="submit" variant="secondary" disabled={resend.isPending}>
                {resend.isPending ? 'Sending…' : 'Send new link'}
              </Button>
              {resend.isSuccess && (
                <p className="text-body-md text-on-surface-variant">If that account needs verification, a new link was sent.</p>
              )}
            </form>
          </>
        )}
      </div>
    </main>
  )
}
