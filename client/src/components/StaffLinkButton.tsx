import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'
import { formatMonthDay } from '../lib/format'
import { Button } from './Button'
import { Modal } from './Modal'
import { Segmented } from './Records'
import type { CreatedStaffLink, StaffLink, StaffRole } from '../types/api'

const ROLE_TEXT: Record<StaffRole, string> = { driver: 'Driver', monitor: 'Monitor' }

// "Driver link" / "Monitor link" on the Drivers and Monitors pages: a link the admin sends to
// people so they fill in their own details. Forms land on the Pending page for review; nothing
// is added to the company until the admin approves. The full link is shown only right after it
// is made (the server keeps only a hash of its code).
export function StaffLinkButton({ role }: { role: StaffRole }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <span className="material-symbols-outlined !text-[18px]">link</span>
        {ROLE_TEXT[role]} link
      </Button>
      {open && <StaffLinkModal role={role} onClose={() => setOpen(false)} />}
    </>
  )
}

function StaffLinkModal({ role, onClose }: { role: StaffRole; onClose: () => void }) {
  const queryClient = useQueryClient()
  const key = ['staff-links', role]
  const linksQuery = useQuery({ queryKey: key, queryFn: () => api.get<StaffLink[]>(`/staff-links?role=${role}`) })
  const [days, setDays] = useState<'3' | '7'>('7')
  const [created, setCreated] = useState<CreatedStaffLink | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => api.post<CreatedStaffLink>('/staff-links', { role, expires_in_days: Number(days) }),
    onSuccess: (made) => {
      setCreated(made)
      setCopied(false)
      queryClient.invalidateQueries({ queryKey: key })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not make the link.'),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.post<StaffLink>(`/staff-links/${id}/revoke`),
    onSuccess: (link) => {
      if (created?.link.id === link.id) setCreated(null)
      queryClient.invalidateQueries({ queryKey: key })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not revoke the link.'),
  })

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setCopied(false) // clipboard blocked: the link is on screen to copy by hand
    }
  }

  const links = linksQuery.data ?? []
  const who = role === 'driver' ? 'drivers' : 'monitors'

  return (
    <Modal title={`${ROLE_TEXT[role]} link`} onClose={onClose}>
      <p className="text-[14px] text-muted">
        Send this link to {who} so they fill in their own details. Their forms show up on the Pending page; nobody is added until you approve
        them.
      </p>

      {created ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 rounded-btn border border-line bg-surface-2 px-4 py-3">
            <code className="min-w-0 font-mono text-[13px] break-all text-ink select-all">{created.url}</code>
            <Button type="button" variant="outline" size="sm" onClick={() => copy(created.url)}>
              <span className="material-symbols-outlined !text-[18px]">{copied ? 'check' : 'content_copy'}</span>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="rounded-row bg-caution-bg px-3 py-2 text-[13px] text-caution-fg">
            This link is shown only now. If it gets lost, revoke it below and make a new one.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[14px] text-ink">Link works for</span>
          <Segmented
            label="Link works for"
            value={days}
            onChange={setDays}
            options={[
              { value: '3', label: '3 days' },
              { value: '7', label: '7 days' },
            ]}
          />
          <Button
            onClick={() => {
              setError(null)
              create.mutate()
            }}
            disabled={create.isPending}
          >
            {create.isPending ? 'Making…' : 'Make link'}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-[15px] font-bold text-ink">Active links</h3>
        {linksQuery.isLoading ? (
          <p className="text-[13px] text-muted">Loading…</p>
        ) : links.length === 0 ? (
          <p className="text-[13px] text-muted">No active {role} links.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-divider rounded-btn border border-line">
            {links.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[14px]">
                <span className="min-w-0">
                  <span className="font-medium text-ink">Link …{l.code_hint}</span>
                  <span className="block text-[12px] text-muted">
                    {l.submission_count} of {l.max_submissions} forms · works until {formatMonthDay(l.expires_at)}
                  </span>
                </span>
                <Button variant="danger" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(l.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex justify-end gap-2">
        {created && (
          <Button variant="outline" onClick={() => setCreated(null)}>
            Make another link
          </Button>
        )}
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  )
}
