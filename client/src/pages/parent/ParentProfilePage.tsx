import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { SectionHeader } from '../../components/mobile'
import { AddressText } from '../../components/AddressText'
import { ThemeChooser } from '../../components/ThemeChooser'
import type { ParentProfile, ParentStudentDetail, Student } from '../../types/api'

// Parent app, Profile tab (design 5b): read-only. Self-service edit for parents is
// intentionally admin-only for now (§ permission-changes task): only the admin who created the
// account can change it, so the page says who to ask.
// TODO (v2): self-service password/email change; 2FA / signup verification.
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
        To change your details, contact {company?.name ?? 'your transportation company'}
        {company?.phone ? (
          <>
            {' at '}
            <a className="font-medium text-ink underline-offset-2 hover:underline" href={`tel:${company.phone.replace(/[^0-9+]/g, '')}`}>
              {company.phone}
            </a>
          </>
        ) : null}
        .
      </p>
      <div className="mx-4 mt-6">
        <ThemeChooser />
      </div>
    </div>
  )
}
