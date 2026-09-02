import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { EditAccountModal } from '../../components/EditAccountModal'
import { CsvImportExport } from '../../components/CsvImportExport'
import { ContactLink } from '../../components/ContactLink'
import { Modal } from '../../components/Modal'
import { PasswordStrengthMeter } from '../../components/PasswordStrengthMeter'
import { scoreParentMatch, MATCH_THRESHOLD } from '../../lib/parentMatch'
import type { CsvColumn } from '../../lib/csv'
import type { PublicUser, Student, ParentStudentLink } from '../../types/api'

const CSV_COLUMNS: CsvColumn<PublicUser>[] = [
  { key: 'full_name', header: 'Full Name' },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  { key: 'address', header: 'Address' },
  // Never exported (we don't store/return plaintext) — blank on an existing parent's row
  // leaves their password unchanged on re-import; required for a brand-new row.
  { key: 'password', header: 'Password', value: () => '' },
  { key: 'is_active', header: 'Active', value: (p) => (p.is_active ? 'true' : 'false') },
]

// Parent management — redesigned 2026-09-01 to match the Drivers/Students table style (was
// a plain list + a separate selection-driven access panel). The per-parent student-access
// checklist still exists, just as an expandable row under each parent (same pattern as
// Students' "Contacts" panel) instead of a separate side panel that needed a parent selected
// first.
export function ParentsPage() {
  const queryClient = useQueryClient()

  const parentsQuery = useQuery({ queryKey: ['users', 'parent'], queryFn: () => api.get<PublicUser[]>('/users?role=parent') })
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const linksQuery = useQuery({ queryKey: ['parent-access'], queryFn: () => api.get<ParentStudentLink[]>('/parent-access') })

  const [expandedParentId, setExpandedParentId] = useState<string | null>(null)
  const [editUser, setEditUser] = useState<PublicUser | null>(null)

  const linkedStudentNamesFor = useMemo(() => {
    const studentsById = new Map((studentsQuery.data ?? []).map((s) => [s.id, s.full_name]))
    const byParent = new Map<string, string[]>()
    for (const l of linksQuery.data ?? []) {
      const name = studentsById.get(l.student_id)
      if (!name) continue
      if (!byParent.has(l.parent_user_id)) byParent.set(l.parent_user_id, [])
      byParent.get(l.parent_user_id)!.push(name)
    }
    return (parentId: string) => byParent.get(parentId) ?? []
  }, [studentsQuery.data, linksQuery.data])

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [linkStudentIds, setLinkStudentIds] = useState<Set<string>>(new Set())
  const [studentSearch, setStudentSearch] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)

  function resetAddForm() {
    setFullName('')
    setEmail('')
    setPhone('')
    setAddress('')
    setPassword('')
    setLinkStudentIds(new Set())
    setStudentSearch('')
    setShowAddModal(false)
  }

  const createParent = useMutation({
    mutationFn: async () => {
      const parent = await api.post<PublicUser>('/users', { role: 'parent', fullName, email, phone, address, password })
      for (const studentId of linkStudentIds) {
        await api.post<ParentStudentLink>('/parent-access', { parent_user_id: parent.id, student_id: studentId })
      }
      return parent
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users', 'parent'] })
      if (linkStudentIds.size > 0) queryClient.invalidateQueries({ queryKey: ['parent-access'] })
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
    const q = studentSearch.trim().toLowerCase()
    const all = studentsQuery.data ?? []
    if (!q) return all
    return all.filter((s) => s.full_name.toLowerCase().includes(q))
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
    const password = row['Password']?.trim()
    const activeRaw = row['Active']?.trim().toLowerCase()

    const existing = (parentsQuery.data ?? []).find((p) => p.email.toLowerCase() === email.toLowerCase())
    try {
      if (existing) {
        const patch: Record<string, unknown> = {}
        if (fullName) patch.full_name = fullName
        if (phone) patch.phone = phone
        if (address) patch.address = address
        if (password) patch.password = password
        if (activeRaw) patch.is_active = ['true', '1', 'yes'].includes(activeRaw)
        if (Object.keys(patch).length === 0) return { ok: true, message: 'No changes' }
        await api.patch(`/users/${existing.id}`, patch)
        return { ok: true, message: 'Updated' }
      }
      if (!fullName) return { ok: false, message: 'Full Name is required for a new parent' }
      if (!phone) return { ok: false, message: 'Phone is required for a new parent' }
      if (!address) return { ok: false, message: 'Address is required for a new parent' }
      if (!password) return { ok: false, message: 'Password is required for a new parent' }
      await api.post('/users', { role: 'parent', fullName, email, phone, address, password })
      return { ok: true, message: 'Created' }
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Import failed' }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-headline-lg text-primary">Parents</h1>
        <div className="flex items-center gap-3">
          <CsvImportExport
            entityName="Parents"
            columns={CSV_COLUMNS}
            rows={parentsQuery.data ?? []}
            onImportRow={handleImportRow}
            onImportComplete={() => queryClient.invalidateQueries({ queryKey: ['users', 'parent'] })}
          />
          <Button type="button" onClick={() => setShowAddModal(true)} className="flex items-center gap-1">
            <span className="material-symbols-outlined !text-[18px]">person_add</span>
            Add a Parent
          </Button>
        </div>
      </div>

      <Card className="flex flex-col overflow-hidden">
        <CardHeader>
          <h2 className="text-title-lg text-primary">All Parents</h2>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-outline-variant bg-surface-container-low">
              <tr>
                {['Name', 'Email', 'Phone', 'Address', 'Linked Students', ''].map((h) => (
                  <th key={h} className="px-6 py-2 text-label-md text-secondary uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {(parentsQuery.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-body-md text-on-surface-variant">
                    {parentsQuery.isLoading ? 'Loading…' : 'No parents yet.'}
                  </td>
                </tr>
              ) : (
                (parentsQuery.data ?? []).flatMap((p) => {
                  const linkedNames = linkedStudentNamesFor(p.id)
                  const rows = [
                    <tr key={p.id} className="hover:bg-surface-container-low">
                      <td className="px-6 py-3 text-body-md font-medium">
                        {p.full_name}
                        {!p.is_active && <span className="ml-2 text-label-md text-error">deactivated</span>}
                      </td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">
                        <ContactLink type="email" value={p.email} />
                      </td>
                      <td className="px-6 py-3 text-data-mono text-secondary">
                        <ContactLink type="phone" value={p.phone} />
                      </td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">{p.address ?? '-'}</td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">
                        {linkedNames.length > 0 ? linkedNames.join(', ') : '-'}
                      </td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setExpandedParentId(expandedParentId === p.id ? null : p.id)}
                          className="mr-3 text-label-md text-secondary hover:underline"
                        >
                          {expandedParentId === p.id ? 'Hide Access' : 'Access'}
                        </button>
                        <button type="button" onClick={() => setEditUser(p)} className="text-label-md text-primary hover:underline">
                          Edit
                        </button>
                      </td>
                    </tr>,
                  ]
                  if (expandedParentId === p.id) {
                    rows.push(
                      <tr key={`${p.id}-access`}>
                        <td colSpan={6} className="bg-surface-container-low px-6 py-4">
                          <StudentAccessPanel parent={p} students={studentsQuery.data ?? []} links={linksQuery.data ?? []} />
                        </td>
                      </tr>,
                    )
                  }
                  return rows
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {showAddModal && (
        <Modal title="Add a Parent" onClose={resetAddForm}>
          <form className="flex flex-col gap-3" onSubmit={handleCreate}>
            <Input required placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <Input required type="email" placeholder="Email address (used to log in)" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input required type="tel" placeholder="Phone number (e.g. 555-123-4567)" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Input required placeholder="Home address (street, city, state, zip)" value={address} onChange={(e) => setAddress(e.target.value)} />
            <div className="flex flex-col gap-2">
              <div className="relative flex items-center">
                <Input
                  required
                  type={showPassword ? 'text' : 'password'}
                  minLength={8}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-4 text-outline hover:text-secondary"
                >
                  <span className="material-symbols-outlined">{showPassword ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
              <p className="text-label-md text-on-surface-variant">
                At least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special character.
              </p>
              <PasswordStrengthMeter password={password} />
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-label-md text-on-surface-variant">Link to student(s) (optional, can also be done afterward)</p>
              <Input
                placeholder="Search students…"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
              />
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-outline-variant p-2">
                {filteredStudentsForLinking.length === 0 ? (
                  <p className="px-2 py-1 text-body-md text-on-surface-variant">No students match.</p>
                ) : (
                  filteredStudentsForLinking.map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-surface-container">
                      <input
                        type="checkbox"
                        checked={linkStudentIds.has(s.id)}
                        onChange={() => toggleLinkStudent(s.id)}
                        className="h-4 w-4 rounded border-outline text-primary focus:ring-primary-container"
                      />
                      <span className="text-body-md">{s.full_name}</span>
                      {s.grade && <span className="text-label-md text-on-surface-variant">Grade {s.grade}</span>}
                    </label>
                  ))
                )}
              </div>
              {linkStudentIds.size > 0 && (
                <p className="text-label-md text-on-surface-variant">{linkStudentIds.size} student(s) selected.</p>
              )}
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={createParent.isPending} className="flex-1">
                {createParent.isPending ? 'Creating…' : 'Add Parent'}
              </Button>
              <Button type="button" variant="outline" onClick={resetAddForm}>
                Cancel
              </Button>
            </div>
            {createError && (
              <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">
                {createError}
              </p>
            )}
          </form>
        </Modal>
      )}

      {editUser && (
        <EditAccountModal user={editUser} invalidateKey={['users', 'parent']} onClose={() => setEditUser(null)} />
      )}
    </div>
  )
}

// The expandable "Access" row under a parent — same link/unlink checklist as before, plus
// a passive match highlight (§ auto-match task) on any unlinked student whose guardian info
// closely matches this parent, so the admin notices a likely-missed link without a popup.
function StudentAccessPanel({
  parent,
  students,
  links,
}: {
  parent: PublicUser
  students: Student[]
  links: ParentStudentLink[]
}) {
  const queryClient = useQueryClient()

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

  return (
    <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-lowest">
      <table className="w-full text-left">
        <thead className="border-b border-outline-variant bg-surface-container-low">
          <tr>
            <th className="px-6 py-2 text-label-md text-secondary uppercase">Student</th>
            <th className="px-6 py-2 text-label-md text-secondary uppercase">Grade</th>
            <th className="px-6 py-2 text-label-md text-secondary uppercase">Access</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant">
          {students.map((s) => {
            const hasAccess = linksForParent.has(s.id)
            const { score, signals } = hasAccess ? { score: 0, signals: [] as string[] } : scoreParentMatch(s, parent)
            const isPossibleMatch = !hasAccess && score >= MATCH_THRESHOLD
            return (
              <tr key={s.id} className={isPossibleMatch ? 'bg-amber-500/10 hover:bg-amber-500/15' : 'hover:bg-surface-container-low'}>
                <td className="px-6 py-3 text-body-md font-medium">
                  {s.full_name}
                  {isPossibleMatch && (
                    <span
                      title={signals.join('; ')}
                      className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-label-md text-amber-700"
                    >
                      <span className="material-symbols-outlined !text-[14px]">person_search</span>
                      Possible match
                    </span>
                  )}
                </td>
                <td className="px-6 py-3 text-data-mono text-secondary">{s.grade ?? '-'}</td>
                <td className="px-6 py-3">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={hasAccess}
                      onChange={() => toggleLink(s.id)}
                      disabled={link.isPending || unlink.isPending}
                      className="h-5 w-5 rounded border-outline text-primary focus:ring-primary-container"
                    />
                    <span className="text-label-md text-on-surface-variant">{hasAccess ? 'Linked' : 'Not linked'}</span>
                  </label>
                </td>
              </tr>
            )
          })}
          {students.length === 0 && (
            <tr>
              <td colSpan={3} className="px-6 py-4 text-body-md text-on-surface-variant">
                No students yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
