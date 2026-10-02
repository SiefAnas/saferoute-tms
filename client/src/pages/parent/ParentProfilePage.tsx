import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { SectionHeader } from '../../components/mobile'
import { AddressText } from '../../components/AddressText'
import { ThemeChooser } from '../../components/ThemeChooser'
import { Card, CardHeader, CardTitle } from '../../components/Card'
import { DetailRows } from '../../components/Drawer'
import { PageTopBar } from '../../layouts/TopBar'
import { MD_QUERY, useMediaQuery } from '../../lib/useMediaQuery'
import type { ParentProfile, ParentStudentDetail, Student } from '../../types/api'

// Parent app, Profile tab (design 5b): read-only summary. The parent edits their own name, phone,
// address, email and password on My account (/account, account-settings).
// TODO (v2): 2FA / signup verification.
export function ParentProfilePage() {
  const profileQuery = useQuery({ queryKey: ['parent-me'], queryFn: () => api.get<ParentProfile>('/parent/me') })
  const studentsQuery = useQuery({ queryKey: ['parent-students'], queryFn: () => api.get<Student[]>('/parent/students') })
  const firstId = studentsQuery.data?.[0]?.id
  // The transport company's name comes with a linked student's detail (same cached query the
  // Students tab uses).
  const detailQuery = useQuery({
    queryKey: ['parent-student-detail', firstId],
    queryFn: () => api.get<ParentStudentDetail>(`/parent/students/${firstId}/detail`),
    enabled: Boolean(firstId),
  })
  const p = profileQuery.data
  const company = detailQuery.data?.company

  const rows = [
    { label: 'Name', value: p?.full_name },
    { label: 'Email', value: p?.email },
    { label: 'Phone', value: p?.phone },
    { label: 'Home address', value: p?.address },
    { label: 'Transport company', value: company?.name },
  ]

  const wide = useMediaQuery(MD_QUERY)
  if (wide) {
    // Desktop: admin-style detail card + appearance card.
    return (
      <div className="flex flex-col gap-5">
        <PageTopBar title="Profile" />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Your details</CardTitle>
            </CardHeader>
            <div className="px-5 pb-2">
              <DetailRows
                rows={rows.map((r) => ({
                  k: r.label,
                  v: profileQuery.isLoading ? '…' : r.label === 'Home address' && r.value ? <AddressText address={r.value} className="text-[14px] font-medium text-ink" /> : (r.value ?? '—'),
                }))}
              />
              <p className="py-3 text-[13px] text-muted">
                Change your details in{' '}
                <Link to="/account" className="font-medium text-ink underline-offset-2 hover:underline">
                  My account
                </Link>
                .
              </p>
            </div>
          </Card>
          <Card className="px-5 py-4">
            <ThemeChooser />
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="md:max-w-[680px]">
      <SectionHeader title="Profile" />
      <div className="mx-4 rounded-m border border-line bg-surface shadow-card">
        {rows.map((r, i) => (
          <div key={r.label} className={`flex items-center justify-between gap-3 px-4 py-3 text-[14px] ${i ? 'border-t border-divider' : ''}`}>
            <span className="text-muted">{r.label}</span>
            {r.label === 'Home address' && r.value ? (
              <AddressText address={r.value} className="min-w-0 text-right text-[14px] font-medium text-ink" />
            ) : (
              <span className="min-w-0 truncate text-right font-medium text-ink">{profileQuery.isLoading ? '…' : (r.value ?? '—')}</span>
            )}
          </div>
        ))}
      </div>
      <p className="mx-5 mt-3 text-[13px] text-muted">
        Change your details in{' '}
        <Link to="/account" className="font-medium text-ink underline-offset-2 hover:underline">
          My account
        </Link>
        .
      </p>
      <div className="mx-4 mt-6">
        <ThemeChooser />
      </div>
    </div>
  )
}
