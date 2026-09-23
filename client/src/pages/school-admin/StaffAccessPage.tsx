import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Button } from '../../components/Button'
import { Field, Input } from '../../components/Input'
import { PasswordField } from '../../components/PasswordField'
import { Modal } from '../../components/Modal'
import { ContactLink } from '../../components/ContactLink'
import { EditAccountModal } from '../../components/EditAccountModal'
import { Drawer, DetailRows, DrawerSection } from '../../components/Drawer'
import { EmptyState } from '../../components/EmptyState'
import { StatusBadge } from '../../components/StatusBadge'
import { NameCell, NoMatches, PageIntro, SearchField, StatCard, StatRow, TableCard, TableRow, matches } from '../../components/Records'
import { useToast } from '../../components/Toast'
import { PageTopBar } from '../../layouts/TopBar'
import type { PublicUser, School, Student, StaffAccessGrant } from '../../types/api'

const TEMPLATE = '1.8fr 1.2fr 1.8fr 1fr'

// School Admin — Staff & access (design 5a records template): school staff accounts and which
// students each one can see (a static grant, no date range, §6). Staff only see the students
// they're granted; the grant checklist lives in each staff member's details drawer.
export function StaffAccessPage() {
  const queryClient = useQueryClient()
  const toast = useToast()

  const staffQuery = useQuery({ queryKey: ['users', 'school_staff'], queryFn: () => api.get<PublicUser[]>('/users?role=school_staff') })
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const grantsQuery = useQuery({ queryKey: ['staff-access'], queryFn: () => api.get<StaffAccessGrant[]>('/staff-access') })
  const schoolQuery = useQuery({ queryKey: ['school-me'], queryFn: () => api.get<School>('/schools/me') })

  const [q, setQ] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editUser, setEditUser] = useState<PublicUser | null>(null)

  // ---- Add staff ----
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const createStaff = useMutation({
    mutationFn: () => api.post<PublicUser>('/users', { role: 'school_staff', fullName, email, password }),
    onSuccess: (staff) => {
      queryClient.invalidateQueries({ queryKey: ['users', 'school_staff'] })
      setFullName('')
      setEmail('')
      setPassword('')
      setShowAddModal(false)
      toast.show(`${staff.full_name} added. Choose which students they can see.`)
      setDetailId(staff.id) // straight into their access checklist
    },
    onError: (err) => setCreateError(err instanceof ApiError ? err.message : 'Could not create staff account.'),
  })

  function handleCreateStaff(e: FormEvent) {
    e.preventDefault()
    setCreateError(null)
    createStaff.mutate()
  }

  const studentsFor = useMemo(() => {
    const byId = new Map((studentsQuery.data ?? []).map((s) => [s.id, s]))
    const map = new Map<string, Student[]>()
    for (const g of grantsQuery.data ?? []) {
      const s = byId.get(g.student_id)
      if (!s) continue
      if (!map.has(g.staff_user_id)) map.set(g.staff_user_id, [])
      map.get(g.staff_user_id)!.push(s)
    }
    return (staffId: string) => map.get(staffId) ?? []
  }, [studentsQuery.data, grantsQuery.data])

  const staff = staffQuery.data ?? []
  const withAccess = staff.filter((s) => studentsFor(s.id).length > 0)
  const noAccess = staff.filter((s) => s.is_active && studentsFor(s.id).length === 0)
  const visible = staff.filter((s) => matches(q, s.full_name, s.email))
  const detail = staff.find((s) => s.id === detailId) ?? null
  const totalStudents = studentsQuery.data?.length ?? 0

  const canSee = (s: PublicUser) => {
    const list = studentsFor(s.id)
    if (list.length === 0) return 'No students'
    if (totalStudents && list.length === totalStudents) return `All ${totalStudents} students`
    return list.length <= 3 ? list.map((x) => x.full_name).join(', ') : `${list.length} students`
  }
  const statusOf = (s: PublicUser) =>
    !s.is_active ? (
      <StatusBadge tone="alert" label="Deactivated" />
    ) : studentsFor(s.id).length === 0 ? (
      <StatusBadge tone="caution" label="No access" />
    ) : (
      <StatusBadge tone="success" label="Active" />
    )

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="Staff & access">
        <SearchField value={q} onChange={setQ} placeholder="Search staff" />
        <Button onClick={() => setShowAddModal(true)}>
          <span className="material-symbols-outlined !text-[18px]">person_add</span>
          Add staff
        </Button>
      </PageTopBar>

      <PageIntro>Staff only see the students you grant them.</PageIntro>

      <StatRow>
        <StatCard label="Staff accounts" value={staff.length} sub={schoolQuery.data?.name ?? ' '} />
        <StatCard label="With student access" value={withAccess.length} tone={withAccess.length ? 'success' : 'default'} sub={`of ${staff.length} staff`} />
        <StatCard
          label="No access yet"
          value={noAccess.length}
          tone={noAccess.length ? 'caution' : 'default'}
          sub={noAccess.length ? noAccess.map((s) => s.full_name).join(', ') : 'Everyone can see their students'}
        />
      </StatRow>

      <TableCard template={TEMPLATE} columns={[{ label: 'Staff' }, { label: 'Role' }, { label: 'Can see' }, { label: 'Status' }]}>
        {staffQuery.isLoading ? (
          <p className="border-t border-divider px-5 py-4 text-[14px] text-muted">Loading…</p>
        ) : staff.length === 0 ? (
          <EmptyState
            icon="badge"
            title="No staff yet"
            body="Add front-office staff so they can confirm pickups and drop-offs for the students you choose."
            action={<Button onClick={() => setShowAddModal(true)}>Add staff</Button>}
          />
        ) : visible.length === 0 ? (
          <NoMatches q={q} hint="Search looks at staff names and emails." onClear={() => setQ('')} />
        ) : (
          visible.map((s) => (
            <TableRow key={s.id} template={TEMPLATE} selected={detailId === s.id} onClick={() => setDetailId(s.id)}>
              <NameCell name={s.full_name} sub={s.email} />
              <span className="text-ink-sub">School staff</span>
              <span className="truncate text-ink-sub">{canSee(s)}</span>
              <span>{statusOf(s)}</span>
            </TableRow>
          ))
        )}
      </TableCard>

      {detail && (
        <Drawer
          eyebrow="DETAILS"
          title={detail.full_name}
          subtitle={detail.email}
          onClose={() => setDetailId(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditUser(detail)}>
                <span className="material-symbols-outlined !text-[18px]">edit</span>
                Edit
              </Button>
              <Button onClick={() => setDetailId(null)}>Done</Button>
            </div>
          }
        >
          <DetailRows
            rows={[
              { k: 'Status', v: statusOf(detail) },
              { k: 'Email', v: <ContactLink type="email" value={detail.email} /> },
              { k: 'Phone', v: <ContactLink type="phone" value={detail.phone} /> },
              { k: 'Can see', v: canSee(detail) },
            ]}
          />
          <AccessChecklist staffId={detail.id} students={studentsQuery.data ?? []} grants={grantsQuery.data ?? []} />
        </Drawer>
      )}

      {showAddModal && (
        <Modal title="Add staff" onClose={() => setShowAddModal(false)}>
          <form className="flex flex-col gap-3" onSubmit={handleCreateStaff}>
            <Field label="Full name">
              <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <Field label="Email (used to log in)">
              <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <PasswordField label="Password" required value={password} onChange={setPassword} />
            {createError && (
              <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
                {createError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createStaff.isPending}>
                {createStaff.isPending ? 'Creating…' : 'Add staff'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {editUser && <EditAccountModal user={editUser} invalidateKey={['users', 'school_staff']} onClose={() => setEditUser(null)} />}
      {toast.node}
    </div>
  )
}

function AccessChecklist({ staffId, students, grants }: { staffId: string; students: Student[]; grants: StaffAccessGrant[] }) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')
  const grantsForStaff = useMemo(() => new Map(grants.filter((g) => g.staff_user_id === staffId).map((g) => [g.student_id, g.id])), [grants, staffId])

  const grant = useMutation({
    mutationFn: (studentId: string) => api.post<StaffAccessGrant>('/staff-access', { staff_user_id: staffId, student_id: studentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff-access'] }),
  })
  const revoke = useMutation({
    mutationFn: (grantId: string) => api.delete(`/staff-access/${grantId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff-access'] }),
  })

  function toggle(studentId: string) {
    const existing = grantsForStaff.get(studentId)
    if (existing) revoke.mutate(existing)
    else grant.mutate(studentId)
  }

  const rows = students
    .filter((s) => matches(filter, s.full_name, s.grade))
    .sort((a, b) => Number(grantsForStaff.has(b.id)) - Number(grantsForStaff.has(a.id)) || a.full_name.localeCompare(b.full_name))

  return (
    <DrawerSection title="Student access">
      <Input placeholder="Filter students…" aria-label="Filter students" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="flex flex-col">
        {rows.length === 0 ? (
          <p className="py-2 text-[13px] text-muted">{students.length ? 'No students match.' : 'No students yet.'}</p>
        ) : (
          rows.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-1 py-2 text-[14px]">
              <input
                type="checkbox"
                checked={grantsForStaff.has(s.id)}
                onChange={() => toggle(s.id)}
                disabled={grant.isPending || revoke.isPending}
                className="h-4 w-4 accent-amber"
              />
              <span className="flex-1 text-ink">
                {s.full_name}
                {s.grade && <span className="text-[12px] text-muted"> · Grade {s.grade}</span>}
              </span>
              <span className="text-[12px] text-muted">{grantsForStaff.has(s.id) ? 'Can see' : 'No access'}</span>
            </label>
          ))
        )}
      </div>
    </DrawerSection>
  )
}
