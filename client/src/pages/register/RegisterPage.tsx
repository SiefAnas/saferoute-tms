import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { ROLE_HOME } from '../../lib/roleHome'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import type { ClaimCandidate, OrgKind, SignupResponse } from '../../types/api'

// Self-serve registration (§5.2/§5.3) — only Company and School orgs self-register
// (as company_admin / school_admin); drivers and school_staff are admin-invited, so
// there's no role picker here beyond which SIDE is signing up.
//
// Two paths, both against the already-tested signup service:
//  - "Create new": brand-new org, operational immediately (mode: 'created').
//  - "Claim existing": fuzzy-search an unclaimed placeholder (reuses the Step-1 trigram
//    index), lock it, and require email verification before it's operational
//    (mode: 'pending_claim') — see VerifyEmailPage.
export function RegisterPage() {
  const { login } = useAuth()
  const navigate = useNavigate()

  const [kind, setKind] = useState<OrgKind>('company')
  const [claiming, setClaiming] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [claimId, setClaimId] = useState('')
  const [claimedName, setClaimedName] = useState('')

  const [orgName, setOrgName] = useState('')
  const [address, setAddress] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [pendingClaimEmail, setPendingClaimEmail] = useState<string | null>(null)

  // Reset the "which side / which mode" state when either toggle changes, so a stale
  // claimId from a previous kind/mode can't leak into a submit.
  useEffect(() => {
    setClaimId('')
    setClaimedName('')
    setSearch('')
  }, [kind, claiming])

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])

  const candidatesQuery = useQuery({
    queryKey: ['claimable', kind, debouncedSearch],
    queryFn: () => api.get<{ candidates: ClaimCandidate[] }>(`/signup/${kind}/claimable?name=${encodeURIComponent(debouncedSearch)}`),
    enabled: claiming && debouncedSearch.length >= 2,
  })

  const submit = useMutation({
    mutationFn: () =>
      api.post<SignupResponse>(`/signup/${kind}`, {
        fullName,
        email,
        password,
        ...(claiming ? { claimId } : { orgName, address: address || undefined }),
      }),
    onSuccess: async (res) => {
      if (res.mode === 'created') {
        const user = await login(email, password)
        navigate(ROLE_HOME[user.role], { replace: true })
      } else {
        setPendingClaimEmail(res.email)
      }
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Registration failed. Please try again.'),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (claiming && !claimId) {
      setError('Select an organization to claim from the search results below.')
      return
    }
    submit.mutate()
  }

  if (pendingClaimEmail) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface p-4">
        <div className="flex w-full max-w-[440px] flex-col items-center gap-4 rounded-xl border border-outline-variant bg-white p-8 text-center">
          <span className="material-symbols-outlined !text-[40px] text-primary">mark_email_read</span>
          <h1 className="text-headline-md text-primary">Check your email</h1>
          <p className="text-body-md text-on-surface-variant">
            We sent a verification link to <strong>{pendingClaimEmail}</strong>. Verify your email to finish
            claiming <strong>{claimedName}</strong> and activate your account.
          </p>
          <Link to="/login" className="text-label-md text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className="flex w-full max-w-[480px] flex-col gap-6 rounded-xl border border-outline-variant bg-white p-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-lg bg-primary-container">
            <span className="material-symbols-outlined !text-[40px] text-on-primary-container">route</span>
          </div>
          <h1 className="text-headline-md text-primary">Register your organization</h1>
          <p className="text-label-md text-secondary uppercase">Self-serve signup — no verification required for a new org</p>
        </div>

        <div className="flex gap-2">
          {(['company', 'school'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`flex-1 rounded-lg border px-4 py-2 text-label-md transition-colors ${
                kind === k ? 'border-primary bg-primary-fixed text-on-primary-fixed-variant' : 'border-outline-variant text-on-surface-variant'
              }`}
            >
              {k === 'company' ? 'Transportation Company' : 'School'}
            </button>
          ))}
        </div>

        <div className="flex gap-2 text-body-md">
          <button
            type="button"
            onClick={() => setClaiming(false)}
            className={`flex-1 rounded-lg px-4 py-2 transition-colors ${!claiming ? 'bg-secondary text-on-secondary' : 'text-on-surface-variant hover:bg-surface-container'}`}
          >
            Create new
          </button>
          <button
            type="button"
            onClick={() => setClaiming(true)}
            className={`flex-1 rounded-lg px-4 py-2 transition-colors ${claiming ? 'bg-secondary text-on-secondary' : 'text-on-surface-variant hover:bg-surface-container'}`}
          >
            Claim existing
          </button>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {claiming ? (
            <div className="flex flex-col gap-2">
              <label className="text-label-md text-on-surface-variant">
                {kind === 'company' ? 'Company' : 'School'} name
              </label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Start typing to search…"
              />
              {debouncedSearch.length >= 2 && (
                <div className="flex flex-col gap-1 rounded-lg border border-outline-variant p-2">
                  {candidatesQuery.isLoading ? (
                    <p className="p-2 text-body-md text-on-surface-variant">Searching…</p>
                  ) : candidatesQuery.data?.candidates.length ? (
                    candidatesQuery.data.candidates.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setClaimId(c.id)
                          setClaimedName(c.name)
                          setSearch(c.name)
                        }}
                        className={`rounded-lg px-3 py-2 text-left text-body-md transition-colors ${
                          claimId === c.id ? 'bg-primary-fixed' : 'hover:bg-surface-container'
                        }`}
                      >
                        <div className="font-medium">{c.name}</div>
                        {c.address && <div className="text-label-md text-on-surface-variant">{c.address}</div>}
                      </button>
                    ))
                  ) : (
                    <p className="p-2 text-body-md text-on-surface-variant">
                      No match — switch to "Create new" if your organization isn't listed yet.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="text-label-md text-on-surface-variant" htmlFor="orgName">
                {kind === 'company' ? 'Company' : 'School'} name
              </label>
              <Input id="orgName" required value={orgName} onChange={(e) => setOrgName(e.target.value)} />
              <label className="text-label-md text-on-surface-variant" htmlFor="address">
                Address <span className="normal-case text-on-surface-variant/70">(optional)</span>
              </label>
              <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-label-md text-on-surface-variant" htmlFor="fullName">
              Your full name
            </label>
            <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-label-md text-on-surface-variant" htmlFor="reg-email">
              Email address
            </label>
            <Input id="reg-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-label-md text-on-surface-variant" htmlFor="reg-password">
              Password
            </label>
            <Input
              id="reg-password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-error-container px-4 py-2 text-body-md text-on-error-container">
              {error}
            </p>
          )}

          <Button type="submit" disabled={submit.isPending} className="w-full">
            {submit.isPending ? 'Submitting…' : claiming ? 'Claim & Register' : 'Create Account'}
          </Button>
        </form>

        <Link to="/login" className="text-center text-label-md text-primary hover:underline">
          Already have an account? Sign in
        </Link>
      </div>
    </main>
  )
}
