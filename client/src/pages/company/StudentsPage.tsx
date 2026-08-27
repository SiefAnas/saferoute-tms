import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { StateAutocomplete } from '../../components/StateAutocomplete'
import type { PublicUser, SchoolSummary, Student, StudentContact } from '../../types/api'

interface GuardianRow {
  name: string
  phone: string
}

// Company Admin — Student creation + edit (§4/§9 frontend gap, extended for the Driver
// dashboard rework, and again 2026-08-27 for the Students page task). POST /students is
// company_admin-only and stamps company_id from the caller, but still needs a school_id (the
// other half of the dual-tenant row). GET /schools (BACKLOG #7) lists real names for schools
// this company already has a student at. For a genuinely new school, this creates an
// unclaimed placeholder first (mirrors school_admin's "Add a Company" panel) and uses its id.
//
// Multi-guardian create (2026-08-27): "Add another parent/guardian" appends more name+phone
// pairs. These are plain contact-info text fields on the student record (student_contacts —
// already-existing table/endpoint from the Driver dashboard rework), NOT new parent login
// accounts — explicitly out of scope per the task. The first row is the student's primary
// contact (students.parent_name/parent_phone, per the original schema decision to keep the
// primary contact as simple fields rather than a table row); any additional rows become
// student_contacts entries created right after the student itself, tagged "Parent/Guardian".
// ASSUMPTION: this multi-row UI is CREATE-only — editing an existing student still uses the
// single primary-contact fields plus the separate "Contacts" panel below (already built,
// already the edit-time path for additional contacts) rather than duplicating that UI here.
export function CompanyStudentsPage() {
  const queryClient = useQueryClient()
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const schoolsQuery = useQuery({ queryKey: ['schools'], queryFn: () => api.get<SchoolSummary[]>('/schools') })
  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })

  const schoolName = useMemo(() => {
    const map = new Map((schoolsQuery.data ?? []).map((s) => [s.id, s.name]))
    return (id: string) => map.get(id) ?? '—'
  }, [schoolsQuery.data])

  const driverName = useMemo(() => {
    const map = new Map((driversQuery.data ?? []).map((d) => [d.id, d.full_name]))
    return (id: string | null) => (id ? (map.get(id) ?? null) : null)
  }, [driversQuery.data])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [grade, setGrade] = useState('')
  const [age, setAge] = useState('')
  const [guardians, setGuardians] = useState<GuardianRow[]>([{ name: '', phone: '' }])
  const [driverUserId, setDriverUserId] = useState('')
  const [streetAddress, setStreetAddress] = useState('')
  const [city, setCity] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [zipCode, setZipCode] = useState('')
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
    setAge('')
    setGuardians([{ name: '', phone: '' }])
    setDriverUserId('')
    setStreetAddress('')
    setCity('')
    setStateCode('')
    setZipCode('')
    setNotes('')
    setNewSchoolName('')
    setNewSchoolAddress('')
    setSchoolId('')
  }

  function startEdit(s: Student) {
    setEditingId(s.id)
    setFullName(s.full_name)
    setGrade(s.grade ?? '')
    setAge(s.age ? String(s.age) : '')
    setGuardians([{ name: s.parent_name ?? '', phone: s.parent_phone ?? '' }])
    setDriverUserId(s.driver_user_id ?? '')
    setStreetAddress(s.street_address ?? '')
    setCity(s.city ?? '')
    setStateCode(s.state ?? '')
    setZipCode(s.zip_code ?? '')
    setNotes(s.notes ?? '')
    setFormError(null)
  }

  function updateGuardian(index: number, field: keyof GuardianRow, value: string) {
    setGuardians((prev) => prev.map((g, i) => (i === index ? { ...g, [field]: value } : g)))
  }
  function addGuardian() {
    setGuardians((prev) => [...prev, { name: '', phone: '' }])
  }
  function removeGuardian(index: number) {
    setGuardians((prev) => prev.filter((_, i) => i !== index))
  }

  const invalidateStudents = () => queryClient.invalidateQueries({ queryKey: ['students'] })

  const createStudent = useMutation({
    mutationFn: async () => {
      const [primary, ...extra] = guardians
      const extraFilled = extra.filter((g) => g.name.trim() || g.phone.trim())
      const incomplete = extraFilled.find((g) => !g.name.trim() || !g.phone.trim())
      if (incomplete) throw new ApiError(400, 'Each additional parent/guardian needs both a name and a phone number.')

      let targetSchoolId = schoolId
      if (schoolMode === 'new') {
        const placeholder = await api.post<{ id: string; name: string }>('/placeholders/school', {
          name: newSchoolName,
          address: newSchoolAddress || undefined,
        })
        targetSchoolId = placeholder.id
      }
      if (!targetSchoolId) throw new ApiError(400, 'Select or create a school first')

      const student = await api.post<Student>('/students', {
        full_name: fullName,
        grade,
        age: Number(age),
        parent_name: primary.name,
        parent_phone: primary.phone,
        driver_user_id: driverUserId || undefined,
        street_address: streetAddress,
        city,
        state: stateCode,
        zip_code: zipCode,
        notes: notes || undefined,
        school_id: targetSchoolId,
      })

      for (const g of extraFilled) {
        await api.post<StudentContact>(`/students/${student.id}/contacts`, {
          name: g.name,
          phone: g.phone,
          relationship: 'Parent/Guardian',
        })
      }
      return student
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
        grade,
        age: Number(age),
        parent_name: guardians[0].name,
        parent_phone: guardians[0].phone,
        driver_user_id: driverUserId || null,
        street_address: streetAddress,
        city,
        state: stateCode,
        zip_code: zipCode,
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
                  {['Name', 'Grade', 'School', 'Address', 'Parent/Guardian', 'Phone', 'Driver', ''].map((h) => (
                    <th key={h} className="px-6 py-2 text-label-md text-secondary uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {(studentsQuery.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-4 text-body-md text-on-surface-variant">
                      {studentsQuery.isLoading ? 'Loading…' : 'No students yet.'}
                    </td>
                  </tr>
                ) : (
                  (studentsQuery.data ?? []).flatMap((s) => [
                    <tr key={s.id} className="hover:bg-surface-container-low">
                      <td className="px-6 py-3 text-body-md font-medium">{s.full_name}</td>
                      <td className="px-6 py-3 text-data-mono text-secondary">{s.grade ?? '—'}</td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">
                        {schoolsQuery.isLoading ? '…' : schoolName(s.school_id)}
                      </td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">
                        {s.street_address ? `${s.street_address}, ${s.city}, ${s.state} ${s.zip_code}` : '—'}
                      </td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">{s.parent_name ?? '—'}</td>
                      <td className="px-6 py-3 text-data-mono text-secondary">{s.parent_phone ?? '—'}</td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">
                        {driversQuery.isLoading ? '…' : (driverName(s.driver_user_id) ?? '(no driver assigned)')}
                      </td>
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
                        <td colSpan={8} className="bg-surface-container-low px-6 py-4">
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
              <Input required placeholder="Grade" value={grade} onChange={(e) => setGrade(e.target.value)} />
              <Input required type="number" placeholder="Age" value={age} onChange={(e) => setAge(e.target.value)} />
            </div>

            <div className="flex flex-col gap-2">
              {guardians.map((g, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="material-symbols-outlined !text-[18px] text-on-surface-variant">family_restroom</span>
                  <Input
                    required
                    placeholder={i === 0 ? 'Parent/guardian name' : 'Additional parent/guardian name'}
                    value={g.name}
                    onChange={(e) => updateGuardian(i, 'name', e.target.value)}
                  />
                  <Input
                    required={i === 0}
                    placeholder="Phone"
                    value={g.phone}
                    onChange={(e) => updateGuardian(i, 'phone', e.target.value)}
                  />
                  {!editingId && i > 0 && (
                    <button
                      type="button"
                      onClick={() => removeGuardian(i)}
                      aria-label="Remove this guardian"
                      className="text-outline hover:text-error"
                    >
                      <span className="material-symbols-outlined !text-[20px]">close</span>
                    </button>
                  )}
                </div>
              ))}
              {!editingId && (
                <button
                  type="button"
                  onClick={addGuardian}
                  className="flex w-fit items-center gap-1 text-label-md text-primary hover:underline"
                >
                  <span className="material-symbols-outlined !text-[18px]">person_add</span>
                  Add another parent/guardian
                </button>
              )}
            </div>

            <select value={driverUserId} onChange={(e) => setDriverUserId(e.target.value)} className={selectClass}>
              <option value="">Assign a driver (optional)…</option>
              {(driversQuery.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </select>

            <Input required placeholder="Street address" value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} />
            <div className="flex gap-2">
              <Input required placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
              <div className="w-32 flex-none">
                <StateAutocomplete required value={stateCode} onChange={setStateCode} />
              </div>
              <Input required placeholder="Zip code" value={zipCode} onChange={(e) => setZipCode(e.target.value)} />
            </div>

            <textarea
              placeholder="Notes (optional — e.g. needs help buckling, needs a monitor)"
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
