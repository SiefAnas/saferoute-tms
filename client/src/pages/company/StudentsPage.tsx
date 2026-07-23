import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import type { SchoolSummary, Student, StudentContact } from '../../types/api'

// Company Admin — Student creation + edit (§4/§9 frontend gap, extended for the Driver
// dashboard rework). POST /students is company_admin-only and stamps company_id from the
// caller, but still needs a school_id (the other half of the dual-tenant row). GET /schools
// (BACKLOG #7) lists real names for schools this company already has a student at. For a
// genuinely new school, this creates an unclaimed placeholder first (mirrors school_admin's
// "Add a Company" panel) and uses its id. Edit reuses the same editingId pattern as
// VansPage.tsx (this codebase's one existing edit-form precedent); school_id is not
// editable, matching the backend's PATCH /students/:id, which doesn't accept it either.
export function CompanyStudentsPage() {
  const queryClient = useQueryClient()
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const schoolsQuery = useQuery({ queryKey: ['schools'], queryFn: () => api.get<SchoolSummary[]>('/schools') })

  const [editingId, setEditingId] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [grade, setGrade] = useState('')
  const [parentName, setParentName] = useState('')
  const [parentPhone, setParentPhone] = useState('')
  const [age, setAge] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')

  const [schoolMode, setSchoolMode] = useState<'existing' | 'new'>('existing')
  const [schoolId, setSchoolId] = useState('')
  const [newSchoolName, setNewSchoolName] = useState('')
  const [newSchoolAddress, setNewSchoolAddress] = useState('')

  const [formError, setFormError] = useState<string | null>(null)
  const [formMsg, setFormMsg] = useState<string | null>(null)
  const [expandedContactsId, setExpandedContactsId] = useState<string | null>(null)

  function resetForm() {
    setEditingId(null)
    setFullName('')
    setGrade('')
    setParentName('')
    setParentPhone('')
    setAge('')
    setAddress('')
    setNotes('')
    setNewSchoolName('')
    setNewSchoolAddress('')
    setSchoolId('')
  }

  function startEdit(s: Student) {
    setEditingId(s.id)
    setFullName(s.full_name)
    setGrade(s.grade ?? '')
    setParentName(s.parent_name ?? '')
    setParentPhone(s.parent_phone ?? '')
    setAge(s.age ? String(s.age) : '')
    setAddress(s.address ?? '')
    setNotes(s.notes ?? '')
    setFormError(null)
  }

  const invalidateStudents = () => queryClient.invalidateQueries({ queryKey: ['students'] })

  const createStudent = useMutation({
    mutationFn: async () => {
      let targetSchoolId = schoolId
      if (schoolMode === 'new') {
        const placeholder = await api.post<{ id: string; name: string }>('/placeholders/school', {
          name: newSchoolName,
          address: newSchoolAddress || undefined,
        })
        targetSchoolId = placeholder.id
      }
      if (!targetSchoolId) throw new ApiError(400, 'Select or create a school first')
      return api.post<Student>('/students', {
        full_name: fullName,
        grade: grade || undefined,
        parent_name: parentName || undefined,
        parent_phone: parentPhone || undefined,
        age: age ? Number(age) : undefined,
        address: address || undefined,
        notes: notes || undefined,
        school_id: targetSchoolId,
      })
    },
    onSuccess: (student) => {
      invalidateStudents()
      if (schoolMode === 'new') queryClient.invalidateQueries({ queryKey: ['schools'] })
      setFormMsg(`Added ${student.full_name}.`)
      resetForm()
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Could not create student.'),
  })

  const updateStudent = useMutation({
    mutationFn: (id: string) =>
      api.patch<Student>(`/students/${id}`, {
        full_name: fullName,
        grade: grade || null,
        parent_name: parentName || null,
        parent_phone: parentPhone || null,
        age: age ? Number(age) : null,
        address: address || null,
        notes: notes || null,
      }),
    onSuccess: () => {
      invalidateStudents()
      setFormMsg('Changes saved.')
      resetForm()
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Could not update student.'),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFormMsg(null)
    if (editingId) updateStudent.mutate(editingId)
    else createStudent.mutate()
  }

  const saving = createStudent.isPending || updateStudent.isPending
  const selectClass =
    'h-14 w-full rounded-lg border border-outline bg-surface-container-lowest px-4 text-body-lg outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20'

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">Students</h1>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-8">
          <CardHeader>
            <h2 className="text-title-lg text-primary">All Students</h2>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr>
                  {['Name', 'Grade', 'Parent/Guardian', 'Phone', ''].map((h) => (
                    <th key={h} className="px-6 py-2 text-label-md text-secondary uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {(studentsQuery.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-4 text-body-md text-on-surface-variant">
                      {studentsQuery.isLoading ? 'Loading…' : 'No students yet.'}
                    </td>
                  </tr>
                ) : (
                  (studentsQuery.data ?? []).flatMap((s) => [
                    <tr key={s.id} className="hover:bg-surface-container-low">
                      <td className="px-6 py-3 text-body-md font-medium">{s.full_name}</td>
                      <td className="px-6 py-3 text-data-mono text-secondary">{s.grade ?? '—'}</td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">{s.parent_name ?? '—'}</td>
                      <td className="px-6 py-3 text-data-mono text-secondary">{s.parent_phone ?? '—'}</td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setExpandedContactsId(expandedContactsId === s.id ? null : s.id)}
                          className="mr-3 text-label-md text-secondary hover:underline"
                        >
                          Contacts
                        </button>
                        <button type="button" onClick={() => startEdit(s)} className="text-label-md text-primary hover:underline">
                          Edit
                        </button>
                      </td>
                    </tr>,
                    expandedContactsId === s.id ? (
                      <tr key={`${s.id}-contacts`}>
                        <td colSpan={5} className="bg-surface-container-low px-6 py-4">
                          <ContactsPanel studentId={s.id} />
                        </td>
                      </tr>
                    ) : null,
                  ])
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="col-span-12 p-5 lg:col-span-4">
          <h2 className="mb-3 text-title-lg text-primary">{editingId ? 'Edit Student' : 'Add a Student'}</h2>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <Input required placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <div className="flex gap-2">
              <Input placeholder="Grade" value={grade} onChange={(e) => setGrade(e.target.value)} />
              <Input type="number" placeholder="Age" value={age} onChange={(e) => setAge(e.target.value)} />
            </div>
            <Input placeholder="Parent/guardian name" value={parentName} onChange={(e) => setParentName(e.target.value)} />
            <Input placeholder="Parent/guardian phone" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} />
            <Input placeholder="Home address" value={address} onChange={(e) => setAddress(e.target.value)} />
            <textarea
              placeholder="Notes (e.g. needs help buckling, needs a monitor)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-outline bg-surface-container-lowest px-4 py-2 text-body-lg outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20"
            />

            {!editingId && (
              <>
                <div className="flex gap-2 text-label-md">
                  <button
                    type="button"
                    onClick={() => setSchoolMode('existing')}
                    className={`flex-1 rounded-lg border px-3 py-2 ${
                      schoolMode === 'existing' ? 'border-primary bg-primary-fixed' : 'border-outline-variant'
                    }`}
                  >
                    Existing school
                  </button>
                  <button
                    type="button"
                    onClick={() => setSchoolMode('new')}
                    className={`flex-1 rounded-lg border px-3 py-2 ${
                      schoolMode === 'new' ? 'border-primary bg-primary-fixed' : 'border-outline-variant'
                    }`}
                  >
                    New school
                  </button>
                </div>

                {schoolMode === 'existing' ? (
                  (schoolsQuery.data ?? []).length === 0 ? (
                    <p className="text-body-md text-on-surface-variant">
                      {schoolsQuery.isLoading ? 'Loading schools…' : 'No known schools yet — switch to "New school" to add one.'}
                    </p>
                  ) : (
                    <select required value={schoolId} onChange={(e) => setSchoolId(e.target.value)} className={selectClass}>
                      <option value="">Select a school…</option>
                      {(schoolsQuery.data ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )
                ) : (
                  <>
                    <Input required placeholder="School name" value={newSchoolName} onChange={(e) => setNewSchoolName(e.target.value)} />
                    <Input
                      placeholder="School address (optional)"
                      value={newSchoolAddress}
                      onChange={(e) => setNewSchoolAddress(e.target.value)}
                    />
                  </>
                )}
              </>
            )}

            <div className="flex gap-2">
              <Button type="submit" variant="secondary" disabled={saving} className="flex-1">
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Student'}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
            {formMsg && <p className="text-body-md text-on-surface-variant">{formMsg}</p>}
            {formError && (
              <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">
                {formError}
              </p>
            )}
          </form>
        </Card>
      </div>
    </div>
  )
}

function ContactsPanel({ studentId }: { studentId: string }) {
  const queryClient = useQueryClient()
  const studentQuery = useQuery({ queryKey: ['student', studentId], queryFn: () => api.get<Student>(`/students/${studentId}`) })
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [relationship, setRelationship] = useState('')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['student', studentId] })

  const addContact = useMutation({
    mutationFn: () => api.post<StudentContact>(`/students/${studentId}/contacts`, { name, phone: phone || undefined, relationship: relationship || undefined }),
    onSuccess: () => {
      invalidate()
      setName('')
      setPhone('')
      setRelationship('')
    },
  })

  const deleteContact = useMutation({
    mutationFn: (contactId: string) => api.delete(`/students/${studentId}/contacts/${contactId}`),
    onSuccess: invalidate,
  })

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (name.trim()) addContact.mutate()
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-title-md text-primary">Additional Contacts</h3>
      {studentQuery.isLoading ? (
        <p className="text-body-md text-on-surface-variant">Loading…</p>
      ) : (studentQuery.data?.contacts ?? []).length === 0 ? (
        <p className="text-body-md text-on-surface-variant">No additional contacts yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {studentQuery.data!.contacts!.map((c) => (
            <li key={c.id} className="flex items-center justify-between text-body-md">
              <span>
                {c.name}
                {c.relationship ? ` (${c.relationship})` : ''}
                {c.phone ? ` — ${c.phone}` : ''}
              </span>
              <button
                type="button"
                onClick={() => deleteContact.mutate(c.id)}
                disabled={deleteContact.isPending}
                className="text-label-md text-error hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex flex-wrap gap-2" onSubmit={handleAdd}>
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="h-10 w-40" />
        <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-10 w-32" />
        <Input placeholder="Relationship" value={relationship} onChange={(e) => setRelationship(e.target.value)} className="h-10 w-36" />
        <Button type="submit" variant="outline" className="h-10 px-4 text-label-md" disabled={addContact.isPending}>
          Add
        </Button>
      </form>
    </div>
  )
}
