import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { formatMonthDay } from '../../lib/format'
import { Button } from '../../components/Button'
import { StatusBadge, type BadgeTone } from '../../components/StatusBadge'
import { ContactLink } from '../../components/ContactLink'
import { Drawer, DetailRows } from '../../components/Drawer'
import { EmptyState } from '../../components/EmptyState'
import { FilterChip, NameCell, NoMatches, PageIntro, SearchField, TableCard, TableRow, matches } from '../../components/Records'
import { useToast } from '../../components/Toast'
import { PageTopBar } from '../../layouts/TopBar'
import type { StaffApproval, StaffRole, StaffSubmission, StaffSubmissionStatus } from '../../types/api'

const TEMPLATE = '1.8fr 0.9fr 1.1fr 1.2fr 0.9fr 1fr'
const STATUS: Record<StaffSubmissionStatus, { tone: BadgeTone; label: string }> = {
  new: { tone: 'info', label: 'New' },
  seen: { tone: 'caution', label: 'Seen' },
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'neutral', label: 'Rejected' },
}
const ROLE_TEXT: Record<StaffRole, string> = { driver: 'Driver', monitor: 'Monitor' }

// Columns of the downloaded spreadsheet, in order.
const SHEET_COLUMNS: [string, (s: StaffSubmission) => string | number][] = [
  ['Role', (s) => ROLE_TEXT[s.role]],
  ['Status', (s) => STATUS[s.status].label],
  ['Full name', (s) => s.full_name],
  ['Phone', (s) => s.phone],
  ['Email', (s) => s.email],
  ['Van plate', (s) => s.van_plate ?? ''],
  ['Van make', (s) => s.van_make ?? ''],
  ['Van model', (s) => s.van_model ?? ''],
  ['Van color', (s) => s.van_color ?? ''],
  ['Van year', (s) => s.van_year ?? ''],
  ['Email already has an account', (s) => (s.email_has_account ? 'Yes' : '')],
  ['Matches van', (s) => s.van_match?.license_plate ?? ''],
  ['Sent', (s) => new Date(s.submitted_at).toLocaleString()],
]

type RoleFilter = 'all' | StaffRole

// Company Admin: forms people sent through a Driver link or Monitor link. Opening one marks it
// seen (the sender can no longer edit it). Approve makes the account (and, for a driver, uses the
// van with the same plate or adds the van) and emails a "choose your password" link.
export function StaffPendingPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [role, setRole] = useState<RoleFilter>('all')
  const [q, setQ] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const path = role === 'all' ? '/staff-submissions' : `/staff-submissions?role=${role}`
  const listQuery = useQuery({ queryKey: ['staff-submissions', role], queryFn: () => api.get<StaffSubmission[]>(path) })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['staff-submissions'] })

  const markSeen = useMutation({
    mutationFn: (id: string) => api.post<StaffSubmission>(`/staff-submissions/${id}/seen`),
    onSuccess: refresh,
  })
  const approve = useMutation({
    mutationFn: (id: string) => api.post<StaffApproval>(`/staff-submissions/${id}/approve`),
    onSuccess: (res) => {
      refresh()
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['vans'] })
      queryClient.invalidateQueries({ queryKey: ['monitors'] })
      toast.show(
        res.van
          ? `${res.user.full_name} approved · ${res.van_matched ? 'matched van' : 'added van'} ${res.van.license_plate} · setup email sent`
          : `${res.user.full_name} approved · setup email sent`,
      )
    },
    onError: (err) => {
      refresh()
      setError(err instanceof ApiError ? err.message : 'Could not approve this form.')
    },
  })
  const reject = useMutation({
    mutationFn: (id: string) => api.post<StaffSubmission>(`/staff-submissions/${id}/reject`),
    onSuccess: () => {
      refresh()
      toast.show('Form rejected')
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not reject this form.'),
  })
  const resend = useMutation({
    mutationFn: (id: string) => api.post(`/staff-submissions/${id}/resend-setup`),
    onSuccess: () => toast.show('New setup email sent'),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not send the setup email.'),
  })

  function openRow(s: StaffSubmission) {
    setError(null)
    setDetailId(s.id)
    if (s.status === 'new') markSeen.mutate(s.id)
  }

  // Built from the database on each click (a fresh read, not the list on screen) and never stored.
  async function downloadExcel() {
    setDownloading(true)
    setError(null)
    try {
      const rows = await api.get<StaffSubmission[]>(path)
      const XLSX = await import('xlsx')
      const sheet = XLSX.utils.aoa_to_sheet([SHEET_COLUMNS.map(([h]) => h), ...rows.map((s) => SHEET_COLUMNS.map(([, get]) => get(s)))])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, sheet, 'Pending')
      XLSX.writeFile(wb, role === 'all' ? 'staff-forms.xlsx' : `${role}-forms.xlsx`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not build the spreadsheet.')
    } finally {
      setDownloading(false)
    }
  }

  const rows = listQuery.data ?? []
  const visible = rows.filter((s) => matches(q, s.full_name, s.email, s.phone, s.van_plate))
  const detail = rows.find((s) => s.id === detailId) ?? null
  const open = detail && (detail.status === 'new' || detail.status === 'seen')
  const busy = approve.isPending || reject.isPending

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="Pending">
        <SearchField value={q} onChange={setQ} placeholder="Search forms" />
        <Button variant="outline" onClick={downloadExcel} disabled={downloading}>
          <span className="material-symbols-outlined !text-[18px]">download</span>
          {downloading ? 'Building…' : 'Download Excel'}
        </Button>
      </PageTopBar>

      <PageIntro>Forms sent through a Driver link or Monitor link. Nobody is added until you approve them.</PageIntro>

      <div className="flex gap-2">
        {(['all', 'driver', 'monitor'] as const).map((r) => (
          <FilterChip key={r} active={role === r} onClick={() => setRole(r)}>
            {r === 'all' ? 'All' : `${ROLE_TEXT[r]}s`}
          </FilterChip>
        ))}
      </div>

      {error && !detail && (
        <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
          {error}
        </p>
      )}

      <TableCard
        template={TEMPLATE}
        columns={[{ label: 'Name' }, { label: 'Role' }, { label: 'Phone' }, { label: 'Van' }, { label: 'Sent' }, { label: 'Status' }]}
      >
        {listQuery.isLoading ? (
          <p className="border-t border-divider px-5 py-4 text-[14px] text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState icon="link" title="No forms yet" body="Make a Driver link or Monitor link on the Drivers or Monitors page and send it out." />
        ) : visible.length === 0 ? (
          <NoMatches q={q} hint="Search looks at names, emails, phone numbers and plates." onClear={() => setQ('')} />
        ) : (
          visible.map((s) => (
            <TableRow key={s.id} template={TEMPLATE} selected={detailId === s.id} onClick={() => openRow(s)}>
              <NameCell name={s.full_name} sub={s.email} />
              <span className="truncate text-ink-sub">{ROLE_TEXT[s.role]}</span>
              <span className="truncate text-ink-sub tabular">{s.phone}</span>
              <span className="truncate text-ink-sub">{s.van_plate ?? '—'}</span>
              <span className="truncate text-ink-sub">{formatMonthDay(s.submitted_at)}</span>
              <span className="flex flex-wrap gap-1">
                <StatusBadge tone={STATUS[s.status].tone} label={STATUS[s.status].label} />
                {s.email_has_account && <StatusBadge tone="alert" label="Has account" />}
              </span>
            </TableRow>
          ))
        )}
      </TableCard>

      {detail && (
        <Drawer
          eyebrow={`${ROLE_TEXT[detail.role].toUpperCase()} FORM`}
          title={detail.full_name}
          subtitle={detail.email}
          onClose={() => setDetailId(null)}
          footer={
            open ? (
              <div className="flex justify-end gap-2">
                <Button variant="danger" disabled={busy} onClick={() => { setError(null); reject.mutate(detail.id) }}>
                  Reject
                </Button>
                <Button disabled={busy || detail.email_has_account} onClick={() => { setError(null); approve.mutate(detail.id) }}>
                  {approve.isPending ? 'Approving…' : 'Approve'}
                </Button>
              </div>
            ) : detail.status === 'approved' ? (
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={resend.isPending} onClick={() => { setError(null); resend.mutate(detail.id) }}>
                  Resend setup email
                </Button>
                <Button onClick={() => setDetailId(null)}>Done</Button>
              </div>
            ) : (
              <div className="flex justify-end">
                <Button onClick={() => setDetailId(null)}>Done</Button>
              </div>
            )
          }
        >
          {detail.email_has_account && (
            <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
              An account with this email already exists, so this form can't make a new one. Check with the person, or reject the form.
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
              {error}
            </p>
          )}
          <DetailRows
            rows={[
              { k: 'Status', v: <StatusBadge tone={STATUS[detail.status].tone} label={STATUS[detail.status].label} /> },
              { k: 'Phone', v: <ContactLink type="phone" value={detail.phone} /> },
              { k: 'Email', v: <ContactLink type="email" value={detail.email} /> },
              ...(detail.role === 'driver'
                ? [
                    { k: 'Van plate', v: detail.van_plate ?? '—' },
                    { k: 'Make / model', v: [detail.van_make, detail.van_model].filter(Boolean).join(' ') || '—' },
                    { k: 'Color', v: detail.van_color ?? '—' },
                    { k: 'Year', v: detail.van_year ?? '—' },
                    {
                      k: 'Fleet',
                      v: detail.van_match
                        ? `Matches van ${detail.van_match.license_plate} (already in your fleet; it won't be changed, color included)`
                        : 'New plate: approving adds this van',
                    },
                  ]
                : []),
              { k: 'Sent', v: new Date(detail.submitted_at).toLocaleString() },
              { k: 'Link', v: `…${detail.link_hint}` },
            ]}
          />
        </Drawer>
      )}
      {toast.node}
    </div>
  )
}
