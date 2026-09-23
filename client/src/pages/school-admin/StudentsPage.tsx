import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { isToday } from '../../lib/format'
import { Button } from '../../components/Button'
import { Field, Input, FIELD_CLASS } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { ContactLink } from '../../components/ContactLink'
import { Drawer, DetailRows, DrawerSection } from '../../components/Drawer'
import { EmptyState, InlineEmpty } from '../../components/EmptyState'
import { StatusBadge, type BadgeTone } from '../../components/StatusBadge'
import { NameCell, NoMatches, PageIntro, SearchField, StatCard, StatRow, TableCard, TableRow, matches } from '../../components/Records'
import { useToast } from '../../components/Toast'
import { PageTopBar } from '../../layouts/TopBar'
import type { AbsentTodayEntry, PublicUser, StaffAccessGrant, Student, TransportEntry, Trip } from '../../types/api'

const TEMPLATE = '1.6fr 1.6fr 1.4fr 1.2fr'
const SHIFT: Record<TransportEntry['shift_period'], string> = { morning: 'Morning', afternoon: 'Afternoon', both: 'All day' }

// School Admin — Students (design 5a records template, school side): every student at this
// school who rides with a transport company, who drives them, and how today is going. The
// transport info comes resolved server-side on GET /students for school readers.
//
// "Add a company" creates an unclaimed placeholder (there's no school↔company link to write;
// the relationship comes from shared students), same as before.
export function StudentsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)

  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const tripsQuery = useQuery({ queryKey: ['trips'], queryFn: () => api.get<Trip[]>('/trips') })
  const absentQuery = useQuery({ queryKey: ['absent-today'], queryFn: () => api.get<AbsentTodayEntry[]>('/dashboard/absent-today') })
  const staffQuery = useQuery({ queryKey: ['users', 'school_staff'], queryFn: () => api.get<PublicUser[]>('/users?role=school_staff') })
  const grantsQuery = useQuery({ queryKey: ['staff-access'], queryFn: () => api.get<StaffAccessGrant[]>('/staff-access') })

  const students = useMemo(() => studentsQuery.data ?? [], [studentsQuery.data])
  const grades = useMemo(() => Array.from(new Set(students.map((s) => s.grade).filter((g): g is string => Boolean(g)))).sort(), [students])

  const todayTrips = useMemo(() => (tripsQuery.data ?? []).filter((t) => isToday(t.created_at)), [tripsQuery.data])
  const absentBy = useMemo(() => new Map((absentQuery.data ?? []).map((a) => [a.student_id, a])), [absentQuery.data])

  function todayFor(s: Student): { label: string; tone: BadgeTone } {
    const absent = absentBy.get(s.id)
    if (absent) return absent.type === 'parent_skipped' ? { label: 'Skipped', tone: 'info' } : { label: 'No-show', tone: 'alert' }
    const mine = todayTrips.filter((t) => t.student_id === s.id).sort((a, b) => b.created_at.localeCompare(a.created_at))
    const latest = mine[0]
    if (latest) {
      if (latest.status === 'pending') return { label: 'Awaiting you', tone: 'caution' }
      return { label: latest.trip_type === 'pickup' ? 'Picked up' : 'Dropped off', tone: 'success' }
    }
    const transport = s.transport ?? []
    if (transport.length === 0) return { label: 'No ride', tone: 'neutral' }
    if (transport.every((t) => t.shift_period === 'afternoon')) return { label: 'Afternoon only', tone: 'neutral' }
    return { label: 'Not yet', tone: 'neutral' }
  }

  function companyDriver(s: Student) {
    const t = s.transport ?? []
    if (t.length === 0) return { main: 'No company yet', sub: '' }
    const company = t[0].company_name ?? 'Transport company'
    const drivers = [...new Set(t.map((x) => x.driver?.full_name).filter(Boolean))]
    return { main: company, sub: drivers.length ? drivers.join(', ') : 'No driver' }
  }

  const visible = students.filter(
    (s) => (!gradeFilter || s.grade === gradeFilter) && matches(q, s.full_name, s.parent_name, s.parent_phone, companyDriver(s).main, companyDriver(s).sub),
  )
  const detail = students.find((s) => s.id === detailId) ?? null

  const riding = students.filter((s) => (s.transport ?? []).length > 0)
  const companies = [...new Set(riding.map((s) => s.transport![0].company_name).filter(Boolean))]
  const pickedUp = new Set(todayTrips.filter((t) => t.trip_type === 'pickup').map((t) => t.student_id)).size
  const staff = (staffQuery.data ?? []).filter((u) => u.is_active)
  const staffWithAccess = new Set((grantsQuery.data ?? []).map((g) => g.staff_user_id))
  const staffWithAccessCount = staff.filter((u) => staffWithAccess.has(u.id)).length

  // ---- Add a company (placeholder) ----
  const [companyName, setCompanyName] = useState('')
  const [companyAddress, setCompanyAddress] = useState('')
  const [companyError, setCompanyError] = useState<string | null>(null)
  const [showAddCompanyModal, setShowAddCompanyModal] = useState(false)
  const createCompany = useMutation({
    mutationFn: () => api.post('/placeholders/company', { name: companyName, address: companyAddress }),
    onSuccess: () => {
      toast.show(`Placeholder created for ${companyName}`)
      setCompanyName('')
      setCompanyAddress('')
      queryClient.invalidateQueries({ queryKey: ['students'] })
      setShowAddCompanyModal(false)
    },
    onError: (err) => setCompanyError(err instanceof ApiError ? err.message : 'Could not create placeholder.'),
  })

  function handleCreateCompany(e: FormEvent) {
    e.preventDefault()
    setCompanyError(null)
    createCompany.mutate()
  }

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="Students">
        <SearchField value={q} onChange={setQ} placeholder="Search students" />
        <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} aria-label="Grade" className={`${FIELD_CLASS} !h-[38px] !w-auto`}>
          <option value="">All grades</option>
          {grades.map((g) => (
            <option key={g} value={g}>
              Grade {g}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={() => setShowAddCompanyModal(true)}>
          <span className="material-symbols-outlined !text-[18px]">add_business</span>
          Add a company
        </Button>
      </PageTopBar>

      <PageIntro>Students at your school who ride with a transport company.</PageIntro>

      <StatRow>
        <StatCard label="Riding students" value={riding.length} sub={companies.length ? `With ${companies.join(', ')}` : 'No transport company yet'} />
        <StatCard
          label="Picked up today"
          value={pickedUp}
          tone={pickedUp ? 'success' : 'default'}
          sub={`${absentQuery.data?.length ?? 0} absent`}
        />
        <StatCard label="Staff with access" value={staffWithAccessCount} sub={`of ${staff.length} staff`} />
      </StatRow>

      <TableCard template={TEMPLATE} columns={[{ label: 'Student' }, { label: 'Company · driver' }, { label: 'Guardian' }, { label: 'Today' }]}>
        {studentsQuery.isLoading ? (
          <p className="border-t border-divider px-5 py-4 text-[14px] text-muted">Loading…</p>
        ) : students.length === 0 ? (
          <EmptyState
            icon="groups"
            title="No students yet"
            body="Students appear here once a transport company adds them for your school."
            action={<Button variant="outline" onClick={() => setShowAddCompanyModal(true)}>Add a company</Button>}
          />
        ) : visible.length === 0 ? (
          <NoMatches
            q={q || `Grade ${gradeFilter}`}
            hint="Search looks at student and guardian names, phones, companies and drivers."
            onClear={() => {
              setQ('')
              setGradeFilter('')
            }}
          />
        ) : (
          visible.map((s) => {
            const cd = companyDriver(s)
            const t = todayFor(s)
            return (
              <TableRow key={s.id} template={TEMPLATE} selected={detailId === s.id} onClick={() => setDetailId(s.id)}>
                <NameCell name={s.full_name} sub={s.grade ? `Grade ${s.grade}` : undefined} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-ink">{cd.main}</span>
                  {cd.sub && <span className="truncate text-[12px] text-muted">{cd.sub}</span>}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-ink">{s.parent_name ?? '—'}</span>
                  <span className="truncate text-[12px] text-muted tabular">{s.parent_phone ?? ''}</span>
                </span>
                <span>
                  <StatusBadge tone={t.tone} label={t.label} />
                </span>
              </TableRow>
            )
          })
        )}
      </TableCard>

      {detail && (
        <Drawer
          eyebrow="DETAILS"
          title={detail.full_name}
          subtitle={[detail.grade ? `Grade ${detail.grade}` : null, detail.age ? `Age ${detail.age}` : null].filter(Boolean).join(' · ')}
          onClose={() => setDetailId(null)}
          footer={
            <div className="flex justify-end">
              <Button onClick={() => setDetailId(null)}>Done</Button>
            </div>
          }
        >
          <DetailRows
            rows={[
              { k: 'Today', v: <StatusBadge tone={todayFor(detail).tone} label={todayFor(detail).label} /> },
              { k: 'Guardian', v: detail.parent_name ?? '—' },
              { k: 'Phone', v: <ContactLink type="phone" value={detail.parent_phone} /> },
              { k: 'Notes', v: detail.notes ?? '—' },
            ]}
          />
          <DrawerSection title="Rides">
            {(detail.transport ?? []).length === 0 ? (
              <InlineEmpty icon="directions_bus" text="No active ride. The transport company assigns drivers." />
            ) : (
              (detail.transport ?? []).map((t, i) => (
                <div key={i} className="flex flex-col gap-0.5 border-b border-divider py-2 text-[14px]">
                  <span className="font-semibold text-ink">
                    {SHIFT[t.shift_period]} · {t.company_name ?? 'Transport company'}
                  </span>
                  <span className="text-ink-sub">
                    {t.driver?.full_name ?? 'No driver'}
                    {t.driver?.phone ? (
                      <>
                        {' · '}
                        <ContactLink type="phone" value={t.driver.phone} />
                      </>
                    ) : null}
                  </span>
                  {t.van && (
                    <span className="text-[13px] text-muted">
                      {[t.van.number ? `Van ${t.van.number}` : null, [t.van.color, t.van.brand, t.van.model].filter(Boolean).join(' '), t.van.license_plate].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
              ))
            )}
          </DrawerSection>
        </Drawer>
      )}

      {showAddCompanyModal && (
        <Modal title="Add a company" onClose={() => setShowAddCompanyModal(false)}>
          <p className="text-[14px] text-muted">
            Not seeing the transport company you work with? Create a placeholder. Once they sign up, they can claim it and the
            relationship shows up automatically through shared students.
          </p>
          <form className="flex flex-col gap-3" onSubmit={handleCreateCompany}>
            <Field label="Company name">
              <Input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </Field>
            <Field label="Address">
              <Input required placeholder="Street, city, state, zip" value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} />
            </Field>
            {companyError && (
              <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
                {companyError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setShowAddCompanyModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createCompany.isPending}>
                {createCompany.isPending ? 'Creating…' : 'Create placeholder'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {toast.node}
    </div>
  )
}
