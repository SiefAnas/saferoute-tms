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
import type { CsvColumn } from '../../lib/csv'
import type { PublicUser, Student, ParentStudentLink } from '../../types/api'

const CSV_COLUMNS: CsvColumn<PublicUser>[] = [
  { key: 'full_name', header: 'Full Name' },
  { key: 'email', header: 'Email' },
  // Never exported (we don't store/return plaintext) — blank on an existing parent's row
  // leaves their password unchanged on re-import; required for a brand-new row.
  { key: 'password', header: 'Password', value: () => '' },
  { key: 'is_active', header: 'Active', value: (p) => (p.is_active ? 'true' : 'false') },
]

// Parent management — mirrors school_admin's Staff & Access page (create + grant/revoke
// access), but company-scoped since parent is a company-side role. Split out from the
// Company Admin Dashboard so parents get their own page (nav restructuring). Full
// link/unlink management (not just at-creation linking) + edit capability, per request.
export function ParentsPage() {
  const queryClient = useQueryClient()

  const parentsQuery = useQuery({ queryKey: ['users', 'parent'], queryFn: () => api.get<PublicUser[]>('/users?role=parent') })
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const linksQuery = useQuery({ queryKey: ['parent-access'], queryFn: () => api.get<ParentStudentLink[]>('/parent-access') })

  const [selectedParentId, setSelectedParentId] = useState('')
  const [editUser, setEditUser] = useState<PublicUser | null>(null)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const createParent = useMutation({
    mutationFn: () => api.post<PublicUser>('/users', { role: 'parent', fullName, email, password }),
    onSuccess: (parent) => {
      queryClient.invalidateQueries({ queryKey: ['users', 'parent'] })
      setFullName('')
      setEmail('')
      setPassword('')
      setSelectedParentId(parent.id)
      setShowAddModal(false)
    },
    onError: (err) => setCreateError(err instanceof ApiError ? err.message : 'Could not create parent account.'),
  })

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError(null)
    createParent.mutate()
  }

  const linksForSelected = useMemo(
    () => new Map((linksQuery.data ?? []).filter((l) => l.parent_user_id === selectedParentId).map((l) => [l.student_id, l.id])),
    [linksQuery.data, selectedParentId],
  )

  const link = useMutation({
    mutationFn: (studentId: string) => api.post<ParentStudentLink>('/parent-access', { parent_user_id: selectedParentId, student_id: studentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['parent-access'] }),
  })
  const unlink = useMutation({
    mutationFn: (linkId: string) => api.delete(`/parent-access/${linkId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['parent-access'] }),
  })

  function toggleLink(studentId: string) {
    const existingLinkId = linksForSelected.get(studentId)
    if (existingLinkId) unlink.mutate(existingLinkId)
    else link.mutate(studentId)
  }

  // CSV import (2026-08-28): upsert by email, same pattern as Drivers. Does not set
  // student links — those are inherently many-to-many and per-pair, not a good fit for one
  // flat CSV row; use the checklist on the right (or link at creation via the Drivers/
  // Parents "Add" form) instead.
  async function handleImportRow(row: Record<string, string>) {
    const email = row['Email']?.trim()
    if (!email) return { ok: false, message: 'Email is required' }
    const fullName = row['Full Name']?.trim()
    const password = row['Password']?.trim()
    const activeRaw = row['Active']?.trim().toLowerCase()

    const existing = (parentsQuery.data ?? []).find((p) => p.email.toLowerCase() === email.toLowerCase())
    try {
      if (existing) {
        const patch: Record<string, unknown> = {}
        if (fullName) patch.full_name = fullName
        if (password) patch.password = password
        if (activeRaw) patch.is_active = ['true', '1', 'yes'].includes(activeRaw)
        if (Object.keys(patch).length === 0) return { ok: true, message: 'No changes' }
        await api.patch(`/users/${existing.id}`, patch)
        return { ok: true, message: 'Updated' }
      }
      if (!fullName) return { ok: false, message: 'Full Name is required for a new parent' }
      if (!password) return { ok: false, message: 'Password is required for a new parent' }
      await api.post('/users', { role: 'parent', fullName, email, password })
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

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 p-5 lg:col-span-4">
          <h2 className="mb-3 text-title-lg text-primary">Parents</h2>
          <ul className="flex flex-col gap-1">
            {(parentsQuery.data ?? []).map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedParentId(p.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelectedParentId(p.id)}
                  className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-left text-body-md transition-colors ${
                    selectedParentId === p.id ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'hover:bg-surface-container'
                  }`}
                >
                  {p.full_name}
                  <span className="ml-2 text-label-md text-on-surface-variant" onClick={(e) => e.stopPropagation()}>
                    <ContactLink type="email" value={p.email} />
                  </span>
                  {!p.is_active && <span className="ml-2 text-label-md text-error">deactivated</span>}
                </div>
                <button
                  type="button"
                  onClick={() => setEditUser(p)}
                  className="text-label-md text-primary hover:underline"
                >
                  Edit
                </button>
              </li>
            ))}
            {parentsQuery.data?.length === 0 && <p className="px-3 text-body-md text-on-surface-variant">No parents yet.</p>}
          </ul>
        </Card>

        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-8">
          <CardHeader>
            <h2 className="text-title-lg text-primary">
              {selectedParentId
                ? `Student access for ${parentsQuery.data?.find((p) => p.id === selectedParentId)?.full_name ?? ''}`
                : 'Select a parent'}
            </h2>
          </CardHeader>
          {!selectedParentId ? (
            <p className="p-6 text-body-md text-on-surface-variant">Choose a parent on the left to manage which students they can see.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-outline-variant bg-surface-container-low">
                  <tr>
                    <th className="px-6 py-2 text-label-md text-secondary uppercase">Student</th>
                    <th className="px-6 py-2 text-label-md text-secondary uppercase">Grade</th>
                    <th className="px-6 py-2 text-label-md text-secondary uppercase">Access</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {(studentsQuery.data ?? []).map((s) => {
                    const hasAccess = linksForSelected.has(s.id)
                    return (
                      <tr key={s.id} className="hover:bg-surface-container-low">
                        <td className="px-6 py-3 text-body-md font-medium">{s.full_name}</td>
                        <td className="px-6 py-3 text-data-mono text-secondary">{s.grade ?? '—'}</td>
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
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {showAddModal && (
        <Modal title="Add a Parent" onClose={() => setShowAddModal(false)}>
          <form className="flex flex-col gap-3" onSubmit={handleCreate}>
            <Input required placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <Input required type="email" placeholder="Email address (used to log in)" value={email} onChange={(e) => setEmail(e.target.value)} />
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
            <div className="flex gap-2">
              <Button type="submit" disabled={createParent.isPending} className="flex-1">
                {createParent.isPending ? 'Creating…' : 'Add Parent'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
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
