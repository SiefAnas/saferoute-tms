import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { EditAccountModal } from '../../components/EditAccountModal'
import type { PublicUser, Student, ParentStudentLink } from '../../types/api'

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
  const [createError, setCreateError] = useState<string | null>(null)
  const createParent = useMutation({
    mutationFn: () => api.post<PublicUser>('/users', { role: 'parent', fullName, email, password }),
    onSuccess: (parent) => {
      queryClient.invalidateQueries({ queryKey: ['users', 'parent'] })
      setFullName('')
      setEmail('')
      setPassword('')
      setSelectedParentId(parent.id)
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

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">Parents</h1>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 p-5 lg:col-span-4">
          <h2 className="mb-3 text-title-lg text-primary">Add Parent</h2>
          <form className="flex flex-col gap-3" onSubmit={handleCreate}>
            <Input required placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <Input required type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input required type="password" minLength={8} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button type="submit" disabled={createParent.isPending}>
              {createParent.isPending ? 'Creating…' : 'Add Parent'}
            </Button>
            {createError && (
              <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">
                {createError}
              </p>
            )}
          </form>

          <h2 className="mt-6 mb-3 text-title-lg text-primary">Parents</h2>
          <ul className="flex flex-col gap-1">
            {(parentsQuery.data ?? []).map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedParentId(p.id)}
                  className={`flex-1 rounded-lg px-3 py-2 text-left text-body-md transition-colors ${
                    selectedParentId === p.id ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'hover:bg-surface-container'
                  }`}
                >
                  {p.full_name}
                  <span className="ml-2 text-label-md text-on-surface-variant">{p.email}</span>
                  {!p.is_active && <span className="ml-2 text-label-md text-error">deactivated</span>}
                </button>
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

      {editUser && (
        <EditAccountModal user={editUser} invalidateKey={['users', 'parent']} onClose={() => setEditUser(null)} />
      )}
    </div>
  )
}
