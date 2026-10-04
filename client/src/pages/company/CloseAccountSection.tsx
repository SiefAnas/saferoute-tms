import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { setLoginNotice, useAuth } from '../../lib/auth'
import { Button } from '../../components/Button'
import { Card, CardHeader } from '../../components/Card'
import { Field, Input } from '../../components/Input'
import { Modal } from '../../components/Modal'
import type { Company, CompanyUsage } from '../../types/api'

const COUNTS: { key: keyof CompanyUsage; one: string; many: string }[] = [
  { key: 'students', one: 'student', many: 'students' },
  { key: 'drivers', one: 'driver', many: 'drivers' },
  { key: 'monitors', one: 'monitor', many: 'monitors' },
  { key: 'vans', one: 'van', many: 'vans' },
  { key: 'schools', one: 'school', many: 'schools' },
]

// The danger zone at the bottom of Company profile (company_admin only). Closing is a request:
// everyone is signed out now and the data is deleted after 30 days unless the admin uses the
// emailed undo link (server/src/services/closure.js). Separated from the profile form above by a
// rule and its own red-bordered card, so it never reads as one more profile field.
export function CloseAccountSection() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  if (user?.role !== 'company_admin') return null
  return (
    <section aria-labelledby="danger-zone" className="mt-6 flex max-w-[640px] flex-col gap-3 border-t border-line pt-6">
      <Card className="!border-alert-fg/40">
        <CardHeader>
          <h2 id="danger-zone" className="text-card-title text-alert-fg">
            Danger zone
          </h2>
        </CardHeader>
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1 text-[14px]">
            <span className="font-semibold text-ink">Close account</span>
            <span className="text-muted">Signs everyone in your company out and deletes all of its data after 30 days.</span>
          </div>
          <Button type="button" variant="danger" onClick={() => setOpen(true)}>
            Close account
          </Button>
        </div>
      </Card>
      {open && <CloseAccountModal onClose={() => setOpen(false)} />}
    </section>
  )
}

function CloseAccountModal({ onClose }: { onClose: () => void }) {
  const { logout } = useAuth()
  const companyQuery = useQuery({ queryKey: ['company-me'], queryFn: () => api.get<Company>('/companies/me') })
  const usageQuery = useQuery({ queryKey: ['company-usage'], queryFn: () => api.get<CompanyUsage>('/companies/me/usage') })
  const [password, setPassword] = useState('')
  const [typedName, setTypedName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const name = companyQuery.data?.name ?? ''

  const close = useMutation({
    mutationFn: () => api.post<{ closure_purge_at: string }>('/companies/me/closure', { currentPassword: password, confirmName: typedName }),
    onSuccess: (res) => {
      // This session was signed out with everyone else's: say what happened on the login page.
      // Not router state: logging out makes ProtectedRoute redirect to /login itself (React
      // Router navigates in a transition, so that redirect wins and drops any state we pass).
      setLoginNotice(
        `Your company account is closing. Everyone is signed out, and the data will be deleted on ${res.closure_purge_at.slice(0, 10)}. We emailed you a link to undo this before then.`,
      )
      logout()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not close the account.'),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    close.mutate()
  }

  const usage = usageQuery.data
  return (
    <Modal title="Close account" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="flex flex-col gap-2 text-[14px] text-ink">
          <p>
            This closes <b className="font-semibold">{name || 'your company'}</b>
            {usage ? ' and everything in it:' : '.'}
          </p>
          {usageQuery.isLoading ? (
            <p className="text-muted">Counting…</p>
          ) : usage ? (
            <ul className="list-disc pl-6">
              {COUNTS.map((c) => (
                <li key={c.key}>
                  {usage[c.key]} {usage[c.key] === 1 ? c.one : c.many}
                </li>
              ))}
            </ul>
          ) : null}
          <p>
            Everyone in your company is signed out now and can't sign in. All of the company's data is deleted after 30 days. Until then
            you can undo this with the link we email you.
          </p>
        </div>
        <Field label="Your password">
          <Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={`Type the company name to confirm: ${name}`}>
          <Input required autoComplete="off" spellCheck={false} value={typedName} onChange={(e) => setTypedName(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={close.isPending || !name || typedName !== name || !password}>
            {close.isPending ? 'Closing…' : 'Close account'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
