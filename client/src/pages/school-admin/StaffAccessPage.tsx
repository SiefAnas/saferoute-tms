import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { ContactLink } from '../../components/ContactLink'
import { PasswordStrengthMeter } from '../../components/PasswordStrengthMeter'
import type { PublicUser, Student, StaffAccessGrant } from '../../types/api'

// School Admin — Staff & Access (§7.3): create/invite School Staff, and grant/revoke
// which staff member can see which students (static assignment, no date range — §6).
export function StaffAccessPage() {
  const queryClient = useQueryClient()

  const staffQuery = useQuery({ queryKey: ['users', 'school_staff'], queryFn: () => api.get<PublicUser[]>('/users?role=school_staff') })
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const grantsQuery = useQuery({ queryKey: ['staff-access'], queryFn: () => api.get<StaffAccessGrant[]>('/staff-access') })

  const [selectedStaffId, setSelectedStaffId] = useState('')

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const createStaff = useMutation({
    mutationFn: () => api.post<PublicUser>('/users', { role: 'school_staff', fullName, email, password }),
    onSuccess: (staff) => {
      queryClient.invalidateQueries({ queryKey: ['users', 'school_staff'] })
      setFullName('')
      setEmail('')
      setPassword('')
      setSelectedStaffId(staff.id)
      setShowAddModal(false)
    },
    onError: (err) => setCreateError(err instanceof ApiError ? err.message : 'Could not create staff account.'),
  })

  function handleCreateStaff(e: FormEvent) {
    e.preventDefault()
    setCreateError(null)
    createStaff.mutate()
  }

  const grantsForSelected = useMemo(
    () => new Map((grantsQuery.data ?? []).filter((g) => g.staff_user_id === selectedStaffId).map((g) => [g.student_id, g.id])),
    [grantsQuery.data, selectedStaffId],
  )

  const grant = useMutation({
    mutationFn: (studentId: string) => api.post<StaffAccessGrant>('/staff-access', { staff_user_id: selectedStaffId, student_id: studentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff-access'] }),
  })
  const revoke = useMutation({
    mutationFn: (grantId: string) => api.delete(`/staff-access/${grantId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff-access'] }),
  })

  function toggleAccess(studentId: string) {
    const existingGrantId = grantsForSelected.get(studentId)
    if (existingGrantId) revoke.mutate(existingGrantId)
    else grant.mutate(studentId)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-headline-lg text-primary">Staff & Access</h1>
        <Button type="button" onClick={() => setShowAddModal(true)} className="flex items-center gap-1">
          <span className="material-symbols-outlined !text-[18px]">person_add</span>
          Add School Staff
        </Button>
      </div>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 p-5 lg:col-span-4">
          <h2 className="mb-3 text-title-lg text-primary">Staff</h2>
          <ul className="flex flex-col gap-1">
            {(staffQuery.data ?? []).map((s) => (
              <li key={s.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedStaffId(s.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelectedStaffId(s.id)}
                  className={`w-full cursor-pointer rounded-lg px-3 py-2 text-left text-body-md transition-colors ${
                    selectedStaffId === s.id ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'hover:bg-surface-container'
                  }`}
                >
                  {s.full_name}
                  <span className="ml-2 text-label-md text-on-surface-variant" onClick={(e) => e.stopPropagation()}>
                    <ContactLink type="email" value={s.email} />
                  </span>
                </div>
              </li>
            ))}
            {staffQuery.data?.length === 0 && <p className="px-3 text-body-md text-on-surface-variant">No staff yet.</p>}
          </ul>
        </Card>

        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-8">
          <CardHeader>
            <h2 className="text-title-lg text-primary">
              {selectedStaffId
                ? `Student access for ${staffQuery.data?.find((s) => s.id === selectedStaffId)?.full_name ?? ''}`
                : 'Select a staff member'}
            </h2>
          </CardHeader>
          {!selectedStaffId ? (
            <p className="p-6 text-body-md text-on-surface-variant">Choose a staff member on the left to manage their student access.</p>
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
                    const hasAccess = grantsForSelected.has(s.id)
                    return (
                      <tr key={s.id} className="hover:bg-surface-container-low">
                        <td className="px-6 py-3 text-body-md font-medium">{s.full_name}</td>
                        <td className="px-6 py-3 text-data-mono text-secondary">{s.grade ?? '-'}</td>
                        <td className="px-6 py-3">
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={hasAccess}
                              onChange={() => toggleAccess(s.id)}
                              disabled={grant.isPending || revoke.isPending}
                              className="h-5 w-5 rounded border-outline text-primary focus:ring-primary-container"
                            />
                            <span className="text-label-md text-on-surface-variant">{hasAccess ? 'Granted' : 'No access'}</span>
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
        <Modal title="Add School Staff" onClose={() => setShowAddModal(false)}>
          <form className="flex flex-col gap-3" onSubmit={handleCreateStaff}>
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
              <Button type="submit" disabled={createStaff.isPending} className="flex-1">
                {createStaff.isPending ? 'Creating…' : 'Add Staff Member'}
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
    </div>
  )
}
