import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Button } from '../../components/Button'
import { Card, CardHeader, CardTitle } from '../../components/Card'
import { Field, Input } from '../../components/Input'
import { PasswordField } from '../../components/PasswordField'
import { ProfileCard } from '../../components/ProfileCard'
import { HomeAddressFields, homeAddressBody, homeAddressOf, sameHomeAddress } from '../../components/HomeAddressFields'
import { PageIntro } from '../../components/Records'
import { useToast } from '../../components/Toast'
import { PageTopBar } from '../../layouts/TopBar'
import { MD_QUERY, useMediaQuery } from '../../lib/useMediaQuery'
import type { DeletionRequest, LoginResponse, OwnAccount, Role } from '../../types/api'

// Roles whose account has a home address (drivers and parents are created with one; see
// services/users.js createUser). Everyone else's account is reached through their org's address.
const ADDRESS_ROLES: Role[] = ['driver', 'parent']
// Roles shown in the driver/parent phone shell, which gives pages no side padding of its own.
const PHONE_SHELL_ROLES: Role[] = ['driver', 'parent', 'monitor']
// Roles that can't close their own account, so they ask for deletion instead. That is every role:
// a company admin can only close the whole company (Company profile), which is no exit for one
// person. School roles ask through their school.
const DELETION_REQUEST_ROLES: Role[] = ['driver', 'monitor', 'parent', 'company_admin', 'school_admin', 'school_staff']
const SCHOOL_ROLES: Role[] = ['school_admin', 'school_staff']
const MAX_REASON = 500

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
          {DELETION_REQUEST_ROLES.includes(account.role) && (
            <DeletionRequestSection school={SCHOOL_ROLES.includes(account.role)} companyAdmin={account.role === 'company_admin'} />
          )}
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
  // A monitor's address is street / city / state / zip: the driver picks them up there.
  const isMonitor = account.role === 'monitor'
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [homeAddress, setHomeAddress] = useState(homeAddressOf(account))
  const [error, setError] = useState<string | null>(null)

  function load(a: OwnAccount) {
    setName(a.full_name)
    setPhone(a.phone ?? '')
    setAddress(a.address ?? '')
    setHomeAddress(homeAddressOf(a))
    setError(null)
  }
  useEffect(() => load(account), [account])

  const dirty =
    name !== account.full_name ||
    phone !== (account.phone ?? '') ||
    (hasAddress && address !== (account.address ?? '')) ||
    (isMonitor && !sameHomeAddress(homeAddress, homeAddressOf(account)))

  const save = useMutation({
    mutationFn: () =>
      api.patch<OwnAccount>('/users/me', {
        full_name: name,
        phone,
        ...(hasAddress ? { address } : {}),
        ...(isMonitor ? homeAddressBody(homeAddress) : {}),
      }),
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
        {isMonitor && (
          <HomeAddressFields className="sm:col-span-2" label="Home address (your driver picks you up here)" value={homeAddress} onChange={setHomeAddress} />
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

// "Request my data be deleted" (every role). Records the request and emails
// SafeTurns and the admins of the person's company or school; nothing is deleted automatically. One open request at a time: while one
// is open, its state shows instead of the form.
function DeletionRequestSection({ school, companyAdmin }: { school: boolean; companyAdmin: boolean }) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['deletion-request'],
    queryFn: () => api.get<{ request: DeletionRequest | null }>('/users/me/deletion-request'),
  })
  const send = useMutation({
    mutationFn: () => api.post<{ request: DeletionRequest }>('/users/me/deletion-request', { reason }),
    onSuccess: (res) => {
      queryClient.setQueryData(['deletion-request'], res)
      setReason('')
    },
    onError: (err) => {
      setError(errorText(err, 'Could not send the request.'))
      // 409: one is already open (e.g. sent from another device); show it.
      if (err instanceof ApiError && err.status === 409) queryClient.invalidateQueries({ queryKey: ['deletion-request'] })
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    send.mutate()
  }

  const open = query.data?.request
  const org = school ? 'school' : 'company'
  return (
    <Section title="Request my data be deleted">
      <p className="text-[14px] text-muted">
        {companyAdmin
          ? 'Closing the company account (Company profile) closes it for everyone. To have only your own data deleted, ask here.'
          : school
            ? "Your account is part of your school's SafeTurns account, so you can't close it yourself."
            : "Your account was set up by your transportation company, so you can't close it yourself."}{' '}
        The request goes to SafeTurns and to your {org}'s {companyAdmin ? 'other admins' : 'admins'}, and they will contact
        you. Nothing is deleted automatically.
      </p>
      {query.isLoading ? (
        <p className="text-[14px] text-muted">Loading…</p>
      ) : open ? (
        <div role="status" className="flex flex-col gap-1.5 rounded-row border border-line bg-surface-2 p-4 text-[14px] text-ink">
          <span className="font-semibold">Request sent on {new Date(open.requested_at).toLocaleDateString()}</span>
          <span>
            SafeTurns and your {org}'s {companyAdmin ? 'other admins' : 'admins'} have it. They will contact you about what happens next.
          </span>
          {open.reason && <span className="text-muted">Your reason: {open.reason}</span>}
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="Reason (optional)">
            <textarea
              value={reason}
              maxLength={MAX_REASON}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-row border border-outline bg-surface px-3 py-2 text-[14px] text-ink outline-none transition-[border-color,box-shadow] focus:border-amber focus:ring-2 focus:ring-amber/20"
            />
            <span className="text-[12px] font-normal text-muted">
              {reason.length} / {MAX_REASON}
            </span>
          </Field>
          <ErrorLine error={error} />
          <div className="flex justify-end">
            <Button type="submit" variant="danger" disabled={send.isPending}>
              {send.isPending ? 'Sending…' : 'Send deletion request'}
            </Button>
          </div>
        </form>
      )}
    </Section>
  )
}
