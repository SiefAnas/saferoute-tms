import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Button } from '../../components/Button'
import { Field, Input } from '../../components/Input'
import { TemporaryPasswordDialog } from '../../components/TemporaryPasswordDialog'
import { EditAccountModal } from '../../components/EditAccountModal'
import { CsvImportExport } from '../../components/CsvImportExport'
import { ContactLink } from '../../components/ContactLink'
import { Modal } from '../../components/Modal'
import { Drawer, DetailRows, DrawerSection } from '../../components/Drawer'
import { EmptyState } from '../../components/EmptyState'
import { StatusBadge } from '../../components/StatusBadge'
import { NameCell, NoMatches, PageIntro, SearchField, StatCard, StatRow, TableCard, TableRow, matches } from '../../components/Records'
import { useToast } from '../../components/Toast'
import { PageTopBar } from '../../layouts/TopBar'
import { scoreParentMatch, MATCH_THRESHOLD } from '../../lib/parentMatch'
import type { CsvColumn } from '../../lib/csv'
import type { AbsentTodayEntry, CreatedUser, PublicUser, Student, ParentStudentLink } from '../../types/api'

const CSV_COLUMNS: CsvColumn<PublicUser>[] = [
  { key: 'full_name', header: 'Full Name' },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  { key: 'address', header: 'Address' },
  { key: 'is_active', header: 'Active', value: (p) => (p.is_active ? 'true' : 'false') },
]

const TEMPLATE = '1.8fr 1.2fr 1.8fr 1fr'

// Company Admin — Parents (design 5a records template): parent logins and which students each
// one can see. The per-parent student-access checklist lives in the row's details drawer.
export function ParentsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()

  const parentsQuery = useQuery({ queryKey: ['users', 'parent'], queryFn: () => api.get<PublicUser[]>('/users?role=parent') })
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const linksQuery = useQuery({ queryKey: ['parent-access'], queryFn: () => api.get<ParentStudentLink[]>('/parent-access') })
  const absentQuery = useQuery({ queryKey: ['dashboard-absent-today'], queryFn: () => api.get<AbsentTodayEntry[]>('/dashboard/absent-today') })

  const [q, setQ] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editUser, setEditUser] = useState<PublicUser | null>(null)

  const linkedStudentsFor = useMemo(() => {
    const studentsById = new Map((studentsQuery.data ?? []).map((s) => [s.id, s]))
    const byParent = new Map<string, Student[]>()
    for (const l of linksQuery.data ?? []) {
      const st = studentsById.get(l.student_id)
      if (!st) continue
      if (!byParent.has(l.parent_user_id)) byParent.set(l.parent_user_id, [])
      byParent.get(l.parent_user_id)!.push(st)
    }
    return (parentId: string) => byParent.get(parentId) ?? []
  }, [studentsQuery.data, linksQuery.data])

  // ---- Add parent ----
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [created, setCreated] = useState<CreatedUser | null>(null)
  const [linkStudentIds, setLinkStudentIds] = useState<Set<string>>(new Set())
  const [studentSearch, setStudentSearch] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)

  function resetAddForm() {
    setFullName('')
    setEmail('')
    setPhone('')
    setAddress('')
    setLinkStudentIds(new Set())
    setStudentSearch('')
    setShowAddModal(false)
  }

  const createParent = useMutation({
    mutationFn: async () => {
      // No password: the server makes a temporary one (shown once) that the parent replaces.
      const parent = await api.post<CreatedUser>('/users', { role: 'parent', fullName, email, phone, address })
      for (const studentId of linkStudentIds) {
        await api.post<ParentStudentLink>('/parent-access', { parent_user_id: parent.id, student_id: studentId })
      }
      return parent
    },
    onSuccess: (parent) => {
      queryClient.invalidateQueries({ queryKey: ['users', 'parent'] })
      if (linkStudentIds.size > 0) queryClient.invalidateQueries({ queryKey: ['parent-access'] })
      setCreated(parent)
      resetAddForm()
    },
    onError: (err) => setCreateError(err instanceof ApiError ? err.message : 'Could not create parent account.'),
  })

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError(null)
    createParent.mutate()
  }

  function toggleLinkStudent(studentId: string) {
    setLinkStudentIds((prev) => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  const filteredStudentsForLinking = useMemo(() => {
    const needle = studentSearch.trim().toLowerCase()
    const all = studentsQuery.data ?? []
    if (!needle) return all
    return all.filter((s) => s.full_name.toLowerCase().includes(needle))
  }, [studentsQuery.data, studentSearch])

  // CSV import (2026-08-28, extended 2026-09-01 for phone/address): upsert by email, same
  // pattern as Drivers. Does not set student links — those are per-pair, not a good fit for
  // one flat CSV row; use the access panel (or link at creation via the Add Parent form).
  async function handleImportRow(row: Record<string, string>) {
    const email = row['Email']?.trim()
    if (!email) return { ok: false, message: 'Email is required' }
    const fullName = row['Full Name']?.trim()
    const phone = row['Phone']?.trim()
    const address = row['Address']?.trim()
    const activeRaw = row['Active']?.trim().toLowerCase()

    const existing = (parentsQuery.data ?? []).find((p) => p.email.toLowerCase() === email.toLowerCase())
    try {
      if (existing) {
        const patch: Record<string, unknown> = {}
        if (fullName) patch.full_name = fullName
        if (phone) patch.phone = phone
        if (address) patch.address = address
        if (activeRaw) patch.is_active = ['true', '1', 'yes'].includes(activeRaw)
        if (Object.keys(patch).length === 0) return { ok: true, message: 'No changes' }
        await api.patch(`/users/${existing.id}`, patch)
        return { ok: true, message: 'Updated' }
      }
      if (!fullName) return { ok: false, message: 'Full Name is required for a new parent' }
      if (!phone) return { ok: false, message: 'Phone is required for a new parent' }
      if (!address) return { ok: false, message: 'Address is required for a new parent' }
      const made = await api.post<CreatedUser>('/users', { role: 'parent', fullName, email, phone, address })
      return { ok: true, message: `Created · temporary password ${made.temporary_password}` }
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Import failed' }
    }
  }

  const parents = parentsQuery.data ?? []
  const notLinked = parents.filter((p) => p.is_active && linkedStudentsFor(p.id).length === 0)
  const skippedIds = new Set((absentQuery.data ?? []).filter((a) => a.type === 'parent_skipped').map((a) => a.student_id))
  const skippedParents = parents.filter((p) => linkedStudentsFor(p.id).some((s) => skippedIds.has(s.id)))
  const deactivated = parents.filter((p) => !p.is_active).length
  const visible = parents.filter((p) => matches(q, p.full_name, p.email, p.phone, ...linkedStudentsFor(p.id).map((s) => s.full_name)))
  const detail = parents.find((p) => p.id === detailId) ?? null

  const statusOf = (p: PublicUser) =>
    !p.is_active
      ? <StatusBadge tone="alert" label="Deactivated" />
      : linkedStudentsFor(p.id).length === 0
        ? <StatusBadge tone="caution" label="Not linked" />
        : <StatusBadge tone="success" label="Active" />

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="Parents">
        <SearchField value={q} onChange={setQ} placeholder="Search parents" />
        <CsvImportExport
          entityName="Parents"
          columns={CSV_COLUMNS}
          rows={parents}
          onImportRow={handleImportRow}
          onImportComplete={() => queryClient.invalidateQueries({ queryKey: ['users', 'parent'] })}
        />
        <Button onClick={() => setShowAddModal(true)}>
          <span className="material-symbols-outlined !text-[18px]">person_add</span>
          Add parent
        </Button>
      </PageTopBar>

      <PageIntro>Parent logins and which students each one can see.</PageIntro>

      <StatRow>
        <StatCard label="Parent accounts" value={parents.length} sub={deactivated ? `${deactivated} deactivated` : 'All active'} />
        <StatCard
          label="Not linked to a student"
          value={notLinked.length}
          tone={notLinked.length ? 'caution' : 'default'}
          sub={notLinked.length ? notLinked.map((p) => p.full_name).join(', ') : 'Everyone can see their children'}
        />
        <StatCard
          label="Skipped a pickup today"
          value={skippedParents.length}
          sub={skippedParents.length ? 'Drivers and schools were notified' : 'No skips today'}
        />
      </StatRow>

      <TableCard template={TEMPLATE} columns={[{ label: 'Parent' }, { label: 'Phone' }, { label: 'Linked students' }, { label: 'Status' }]}>
        {parentsQuery.isLoading ? (
          <p className="border-t border-divider px-5 py-4 text-[14px] text-muted">Loading…</p>
        ) : parents.length === 0 ? (
          <EmptyState
            icon="family_restroom"
            title="No parents yet"
            body="Give parents a login so they can see their child's ride and skip a pickup."
            action={<Button onClick={() => setShowAddModal(true)}>Add parent</Button>}
          />
        ) : visible.length === 0 ? (
          <NoMatches q={q} hint="Search looks at parent names, emails, phones and linked students." onClear={() => setQ('')} />
        ) : (
          visible.map((p) => {
            const linked = linkedStudentsFor(p.id)
            return (
              <TableRow key={p.id} template={TEMPLATE} selected={detailId === p.id} onClick={() => setDetailId(p.id)}>
                <NameCell name={p.full_name} sub={p.email} />
                <span className="truncate text-ink-sub tabular">{p.phone ?? '—'}</span>
                <span className="truncate text-ink-sub">{linked.length ? linked.map((s) => s.full_name).join(', ') : '—'}</span>
                <span>{statusOf(p)}</span>
              </TableRow>
            )
          })
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
              { k: 'Home address', v: detail.address ?? '—' },
            ]}
          />
          <StudentAccessPanel parent={detail} students={studentsQuery.data ?? []} links={linksQuery.data ?? []} />
        </Drawer>
      )}

      {showAddModal && (
        <Modal title="Add parent" onClose={resetAddForm}>
          <form className="flex flex-col gap-3" onSubmit={handleCreate}>
            <Field label="Full name">
              <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Email (used to log in)">
                <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input required type="tel" placeholder="555-123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </div>
            <Field label="Home address">
              <Input required placeholder="Street, city, state, zip" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            <p className="text-[13px] text-muted">
              SafeRoute makes a temporary password for you to give the parent. They choose their own the first time they sign in.
            </p>

            <Field label="Link to students (optional, can also be done later)">
              <Input placeholder="Search students…" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} />
            </Field>
            <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-row border border-line p-1.5">
              {filteredStudentsForLinking.length === 0 ? (
                <p className="px-2 py-1 text-[13px] text-muted">No students match.</p>
              ) : (
                filteredStudentsForLinking.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-row px-2 py-1.5 text-[14px] text-ink hover:bg-surface-2">
                    <input type="checkbox" checked={linkStudentIds.has(s.id)} onChange={() => toggleLinkStudent(s.id)} className="h-4 w-4 accent-amber" />
                    {s.full_name}
                    {s.grade && <span className="text-[12px] text-muted">Grade {s.grade}</span>}
                  </label>
                ))
              )}
            </div>
            {linkStudentIds.size > 0 && <p className="text-[12px] text-muted">{linkStudentIds.size} selected</p>}

            {createError && (
              <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
                {createError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={resetAddForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={createParent.isPending}>
                {createParent.isPending ? 'Creating…' : 'Add parent'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {editUser && <EditAccountModal user={editUser} invalidateKey={['users', 'parent']} onClose={() => setEditUser(null)} />}
      {created && (
        <TemporaryPasswordDialog name={created.full_name} email={created.email} password={created.temporary_password} onClose={() => setCreated(null)} />
      )}
      {toast.node}
    </div>
  )
}

// Which students this parent can see: a link/unlink checklist, plus a passive "Possible match"
// highlight (§ auto-match task) on any unlinked student whose guardian info closely matches
// this parent, so the admin notices a likely-missed link without a popup.
function StudentAccessPanel({ parent, students, links }: { parent: PublicUser; students: Student[]; links: ParentStudentLink[] }) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')

  const linksForParent = useMemo(
    () => new Map(links.filter((l) => l.parent_user_id === parent.id).map((l) => [l.student_id, l.id])),
    [links, parent.id],
  )

  const link = useMutation({
    mutationFn: (studentId: string) => api.post<ParentStudentLink>('/parent-access', { parent_user_id: parent.id, student_id: studentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['parent-access'] }),
  })
  const unlink = useMutation({
    mutationFn: (linkId: string) => api.delete(`/parent-access/${linkId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['parent-access'] }),
  })

  function toggleLink(studentId: string) {
    const existingLinkId = linksForParent.get(studentId)
    if (existingLinkId) unlink.mutate(existingLinkId)
    else link.mutate(studentId)
  }

  // Linked first, then likely matches, then everyone else.
  const rows = students
    .filter((s) => matches(filter, s.full_name))
    .map((s) => {
      const hasAccess = linksForParent.has(s.id)
      const { score, signals } = hasAccess ? { score: 0, signals: [] as string[] } : scoreParentMatch(s, parent)
      return { s, hasAccess, possible: !hasAccess && score >= MATCH_THRESHOLD, signals }
    })
    .sort((a, b) => Number(b.hasAccess) - Number(a.hasAccess) || Number(b.possible) - Number(a.possible) || a.s.full_name.localeCompare(b.s.full_name))

  return (
    <DrawerSection title="Can see">
      <Input placeholder="Filter students…" aria-label="Filter students" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="flex flex-col">
        {rows.length === 0 ? (
          <p className="py-2 text-[13px] text-muted">{students.length ? 'No students match.' : 'No students yet.'}</p>
        ) : (
          rows.map(({ s, hasAccess, possible, signals }) => (
            <label
              key={s.id}
              className={`flex cursor-pointer items-center gap-2.5 border-b border-divider px-1 py-2 text-[14px] ${possible ? 'bg-row-selected' : ''}`}
            >
              <input
                type="checkbox"
                checked={hasAccess}
                onChange={() => toggleLink(s.id)}
                disabled={link.isPending || unlink.isPending}
                className="h-4 w-4 accent-amber"
              />
              <span className="flex-1 text-ink">
                {s.full_name}
                {s.grade && <span className="text-[12px] text-muted"> · Grade {s.grade}</span>}
              </span>
              {possible && (
                <span title={signals.join('; ')}>
                  <StatusBadge tone="caution" label="Possible match" />
                </span>
              )}
            </label>
          ))
        )}
      </div>
    </DrawerSection>
  )
}
