import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Button } from '../../components/Button'
import { Card, CardHeader, CardTitle } from '../../components/Card'
import { Field, Input } from '../../components/Input'
import { PasswordField } from '../../components/PasswordField'
import { ProfileCard } from '../../components/ProfileCard'
import { PageIntro } from '../../components/Records'
import { useToast } from '../../components/Toast'
import { PageTopBar } from '../../layouts/TopBar'
import { MD_QUERY, useMediaQuery } from '../../lib/useMediaQuery'
import type { LoginResponse, OwnAccount, Role } from '../../types/api'

// Roles whose account has a home address (drivers and parents are created with one; see
// services/users.js createUser). Everyone else's account is reached through their org's address.
const ADDRESS_ROLES: Role[] = ['driver', 'parent']
// Roles shown in the driver/parent phone shell, which gives pages no side padding of its own.
const PHONE_SHELL_ROLES: Role[] = ['driver', 'parent', 'monitor']

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
      {error}
    </p>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="max-w-[640px]">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-6 pb-6">{children}</div>
    </Card>
  )
}

// My account (account-settings): the signed-in PERSON, for every role. Profile, email and
// password. The organization's own profile stays on the company / school profile pages.
export function AccountPage() {
  const { user } = useAuth()
  const wide = useMediaQuery(MD_QUERY)
  const accountQuery = useQuery({ queryKey: ['account-me'], queryFn: () => api.get<OwnAccount>('/users/me') })
  const account = accountQuery.data
  const padded = Boolean(user && PHONE_SHELL_ROLES.includes(user.role) && !wide)

  return (
    <div className={`flex flex-col gap-5 ${padded ? 'px-4 pt-4' : ''}`}>
      <PageTopBar title="My account" />
      <PageIntro>Your own sign-in and contact details.</PageIntro>
      {accountQuery.isLoading ? (
        <p className="text-[14px] text-muted">Loading…</p>
      ) : accountQuery.isError || !account ? (
        <ErrorLine error={errorText(accountQuery.error, 'Could not load your account.')} />
      ) : (
        <>
          <ProfileSection account={account} />
          <EmailSection account={account} />
          <PasswordSection />
        </>
      )}
    </div>
  )
}

function ProfileSection({ account }: { account: OwnAccount }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { token, user, setSession } = useAuth()
  const hasAddress = ADDRESS_ROLES.includes(account.role)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)

  function load(a: OwnAccount) {
    setName(a.full_name)
    setPhone(a.phone ?? '')
    setAddress(a.address ?? '')
    setError(null)
  }
  useEffect(() => load(account), [account])

  const dirty = name !== account.full_name || phone !== (account.phone ?? '') || (hasAddress && address !== (account.address ?? ''))

  const save = useMutation({
    mutationFn: () => api.patch<OwnAccount>('/users/me', { full_name: name, phone, ...(hasAddress ? { address } : {}) }),
    onSuccess: (a) => {
      queryClient.setQueryData(['account-me'], a)
      // The sidebar shows the name from the stored session.
      if (token && user) setSession({ token, user: { ...user, full_name: a.full_name } } as LoginResponse)
      toast.show('Profile saved')
    },
    onError: (err) => setError(errorText(err, 'Could not save changes.')),
  })

  return (
    <>
      <ProfileCard
        saving={save.isPending}
        dirty={dirty}
        error={error}
        onCancel={() => load(account)}
        onSubmit={() => {
          setError(null)
          save.mutate()
        }}
      >
        <Field label="Full name" className="sm:col-span-2">
          <Input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="Phone" className={hasAddress ? '' : 'sm:col-span-2'}>
          <Input type="tel" required={account.role === 'parent'} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="555-0123" />
        </Field>
        {hasAddress && (
          <Field label="Home address" className="sm:col-span-2">
            <Input required={account.role === 'parent'} value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" />
          </Field>
        )}
      </ProfileCard>
      {toast.node}
    </>
  )
}

function EmailSection({ account }: { account: OwnAccount }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const onAccount = (a: OwnAccount) => queryClient.setQueryData(['account-me'], a)

  const request = useMutation({
    mutationFn: () => api.post<OwnAccount>('/users/me/email-change', { newEmail: newEmail.trim(), currentPassword: password }),
    onSuccess: (a) => {
      onAccount(a)
      setEditing(false)
      setNewEmail('')
      setPassword('')
      setNotice(null)
    },
    onError: (err) => setError(errorText(err, 'Could not start the email change.')),
  })
  const resend = useMutation({
    mutationFn: () => api.post<OwnAccount>('/users/me/email-change/resend'),
    onSuccess: (a) => {
      onAccount(a)
      setNotice('A new link is on its way. Only the newest link works.')
    },
    onError: (err) => setError(errorText(err, 'Could not resend the link.')),
  })
  const cancel = useMutation({
    mutationFn: () => api.delete<OwnAccount>('/users/me/email-change'),
    onSuccess: (a) => {
      onAccount(a)
      setNotice(null)
      setError(null)
    },
    onError: (err) => setError(errorText(err, 'Could not cancel the email change.')),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    request.mutate()
  }

  return (
    <Section title="Email">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] font-semibold text-muted">Current email (you sign in with this)</span>
        <span className="text-[14px] font-medium text-ink">{account.email}</span>
      </div>

      {account.pending_email ? (
        <div role="status" className="flex flex-col gap-3 rounded-row border border-line bg-surface-2 p-4">
          <div className="flex items-start gap-2.5">
            <span className="material-symbols-outlined !text-[22px] text-muted">mark_email_unread</span>
            <div className="flex flex-col gap-1 text-[14px] text-ink">
              <span className="font-semibold">Check your inbox</span>
              <span>
                We sent a confirmation link to <b className="font-semibold">{account.pending_email}</b>. Your email changes when you
                open it (within 24 hours). Until then, keep signing in with {account.email}.
              </span>
              <span className="text-[13px] text-muted">Opening the link signs you out on every device. Sign in again with the new email.</span>
            </div>
          </div>
          {notice && <p className="text-[13px] text-muted">{notice}</p>}
          <ErrorLine error={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={resend.isPending} onClick={() => { setError(null); resend.mutate() }}>
              {resend.isPending ? 'Sending…' : 'Resend link'}
            </Button>
            <Button type="button" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel change
            </Button>
          </div>
        </div>
      ) : editing ? (
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="New email">
            <Input type="email" required autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </Field>
          <Field label="Current password">
            <Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setEditing(false); setError(null) }}>
              Cancel
            </Button>
            <Button type="submit" disabled={request.isPending}>
              {request.isPending ? 'Sending…' : 'Send confirmation link'}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button type="button" variant="outline" onClick={() => setEditing(true)}>
            Change email
          </Button>
        </div>
      )}
    </Section>
  )
}

function PasswordSection() {
  const { setSession } = useAuth()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)

  const change = useMutation({
    mutationFn: () => api.post<LoginResponse>('/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: (res) => {
      // Older tokens stop working: keep going with the new one.
      setSession(res)
      setCurrent('')
      setNext('')
      setConfirm('')
      toast.show('Password changed. Other devices are signed out.')
    },
    onError: (err) => setError(errorText(err, 'Could not change your password.')),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (next !== confirm) return setError("The new passwords don't match.")
    change.mutate()
  }

  return (
    <Section title="Password">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="Current password">
          <Input type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <PasswordField label="New password" required value={next} onChange={setNext} />
        <Field label="Confirm new password">
          <Input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <ErrorLine error={error} />
        <div className="flex justify-end">
          <Button type="submit" disabled={change.isPending || !current || !next || !confirm}>
            {change.isPending ? 'Saving…' : 'Change password'}
          </Button>
        </div>
      </form>
      {toast.node}
    </Section>
  )
}
