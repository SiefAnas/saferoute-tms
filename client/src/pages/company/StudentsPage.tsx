import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { ContactLink } from '../../components/ContactLink'
import { StateAutocomplete } from '../../components/StateAutocomplete'
import { isAssignmentActiveToday } from '../../lib/format'
import { driverCurrentVanId, vansTakenByOtherDrivers } from '../../lib/assignmentRules'
import { findBestParentMatch } from '../../lib/parentMatch'
import { CsvImportExport } from '../../components/CsvImportExport'
import type { CsvColumn } from '../../lib/csv'
import type { Assignment, ParentStudentLink, PublicUser, SchoolSummary, Student, StudentContact, Van } from '../../types/api'


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
//
// Driver assignment rework (2026-08-27, later): the "Driver" shown for a student is no
// longer a standalone field — it's derived live from the real `assignments` table (whichever
// assignment is active today), same single source of truth the driver's own schedule, payroll,
// and the parent dashboard already use. Picking a driver+van here creates/updates a REAL
// Assignment row via the existing (already company_admin-gated, tenant-scoped) /assignments
// endpoints — not a separate write. Both driver and van are required together (an Assignment
// can't exist with only one); changing them closes the previous active assignment
// (end_date = today) before opening the new one, so a student never has two conflicting
// "current" assignments from this flow.
export function CompanyStudentsPage() {
  const queryClient = useQueryClient()
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const schoolsQuery = useQuery({ queryKey: ['schools'], queryFn: () => api.get<SchoolSummary[]>('/schools') })
  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
  const vansQuery = useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })
  const assignmentsQuery = useQuery({ queryKey: ['assignments'], queryFn: () => api.get<Assignment[]>('/assignments') })
  const parentsQuery = useQuery({ queryKey: ['users', 'parent'], queryFn: () => api.get<PublicUser[]>('/users?role=parent') })
  const parentLinksQuery = useQuery({ queryKey: ['parent-access'], queryFn: () => api.get<ParentStudentLink[]>('/parent-access') })

  const schoolName = useMemo(() => {
    const map = new Map((schoolsQuery.data ?? []).map((s) => [s.id, s.name]))
    return (id: string) => map.get(id) ?? '-'
  }, [schoolsQuery.data])

  // CSV columns (2026-08-28) — includes a "School" column derived from school_id, since
  // that's what both export display and import matching actually need.
  const csvColumns: CsvColumn<Student>[] = useMemo(
    () => [
      { key: 'full_name', header: 'Full Name' },
      { key: 'grade', header: 'Grade' },
      { key: 'age', header: 'Age' },
      { key: 'parent_name', header: 'Parent Name' },
      { key: 'parent_phone', header: 'Parent Phone' },
      { key: 'street_address', header: 'Street Address' },
      { key: 'city', header: 'City' },
      { key: 'state', header: 'State' },
      { key: 'zip_code', header: 'Zip Code' },
      { key: 'school', header: 'School', value: (s) => schoolName(s.school_id) },
      { key: 'notes', header: 'Notes' },
    ],
    [schoolName],
  )

  const driverName = useMemo(() => {
    const map = new Map((driversQuery.data ?? []).map((d) => [d.id, d.full_name]))
    return (id: string | null) => (id ? (map.get(id) ?? null) : null)
  }, [driversQuery.data])

  // Current active assignment per student — most-recently-created one still active today, if
  // more than one somehow overlaps (mirrors the server's own tie-break elsewhere: ORDER BY
  // created_at DESC LIMIT 1).
  const currentAssignmentFor = useMemo(() => {
    const byStudent = new Map<string, Assignment>()
    for (const a of assignmentsQuery.data ?? []) {
      if (!isAssignmentActiveToday(a.start_date, a.end_date)) continue
      const existing = byStudent.get(a.student_id)
      if (!existing || a.created_at > existing.created_at) byStudent.set(a.student_id, a)
    }
    return (studentId: string) => byStudent.get(studentId) ?? null
  }, [assignmentsQuery.data])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [grade, setGrade] = useState('')
  const [age, setAge] = useState('')
  const [guardians, setGuardians] = useState<GuardianRow[]>([{ name: '', phone: '' }])
  const [driverUserId, setDriverUserId] = useState('')
  const [vanId, setVanId] = useState('')
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
  const [showModal, setShowModal] = useState(false)
  const [matchSuggestion, setMatchSuggestion] = useState<{ student: Student; parent: PublicUser; signals: string[] } | null>(null)

  // Auto-match suggestion (§ auto-match task, 2026-09-01) — run after a student is
  // created/edited (not live per keystroke, so it only ever fires against a real saved
  // record). Never auto-links; just surfaces a confirm prompt when a good candidate exists.
  // See client/src/lib/parentMatch.ts for the matching logic + sensitivity tuning notes.
  function checkForParentMatch(student: Student) {
    const alreadyLinkedParentIds = new Set(
      (parentLinksQuery.data ?? []).filter((l) => l.student_id === student.id).map((l) => l.parent_user_id),
    )
    const match = findBestParentMatch(student, parentsQuery.data ?? [], alreadyLinkedParentIds)
    if (match) setMatchSuggestion({ student, parent: match.parent, signals: match.signals })
  }

  // Live conflict filtering (§7 item 3) — this form always assigns "as of today" (syncAssignment
  // always opens a new assignment with start_date = today), so the picker narrows against today.
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const range = useMemo(() => ({ start_date: today, end_date: null as string | null }), [today])
  const assignments = assignmentsQuery.data ?? []
  const excludeAssignmentId = editingId ? currentAssignmentFor(editingId)?.id : undefined
  const lockedVanId = driverUserId ? driverCurrentVanId(assignments, driverUserId, range, excludeAssignmentId) : null
  const excludedVanIds = driverUserId ? vansTakenByOtherDrivers(assignments, driverUserId, range, excludeAssignmentId) : new Set<string>()

  function resetForm() {
    setEditingId(null)
    setFullName('')
    setGrade('')
    setAge('')
    setGuardians([{ name: '', phone: '' }])
    setDriverUserId('')
    setVanId('')
    setStreetAddress('')
    setCity('')
    setStateCode('')
    setZipCode('')
    setNotes('')
    setNewSchoolName('')
    setNewSchoolAddress('')
    setSchoolId('')
    setShowModal(false)
  }

  function startAdd() {
    resetForm()
    setShowModal(true)
  }

  function startEdit(s: Student) {
    setEditingId(s.id)
    setFullName(s.full_name)
    setGrade(s.grade ?? '')
    setAge(s.age ? String(s.age) : '')
    setGuardians([{ name: s.parent_name ?? '', phone: s.parent_phone ?? '' }])
    const current = currentAssignmentFor(s.id)
    setDriverUserId(current?.driver_user_id ?? '')
    setVanId(current?.van_id ?? '')
    setStreetAddress(s.street_address ?? '')
    setCity(s.city ?? '')
    setStateCode(s.state ?? '')
    setZipCode(s.zip_code ?? '')
    setNotes(s.notes ?? '')
    setFormError(null)
    setShowModal(true)
  }

  // Only fires on the user actively changing the driver dropdown (not on the programmatic
  // startEdit population) — locks the van to whatever van that driver is already driving
  // today, if any, matching the real Assignment picker on the Assignments page.
  function handleDriverSelect(id: string) {
    setDriverUserId(id)
    if (!id) {
      setVanId('')
      return
    }
    const locked = driverCurrentVanId(assignments, id, range, excludeAssignmentId)
    setVanId(locked ?? '')
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

  // CSV import (2026-08-28) is CREATE-ONLY, unlike Drivers/Fleet. ASSUMPTION, flagged: unlike
  // people (matched by email) and vans (matched by plate), students have no reliable natural
  // key — full_name alone risks silently overwriting the WRONG student on a name collision.
  // Rather than guess at a compound key, every CSV row always inserts a new student; bulk
  // *updating* existing students isn't supported via CSV. Matches "onboarding a class list"
  // being the real use case named for this feature better than "update by spreadsheet" would.
  // Does not set a driver/van (no reliable way to name them safely in a bulk import either) —
  // assign those afterward via the form or the Assignments page.
  async function handleImportRow(row: Record<string, string>) {
    const fullName = row['Full Name']?.trim()
    const grade = row['Grade']?.trim()
    const ageRaw = row['Age']?.trim()
    const parentName = row['Parent Name']?.trim()
    const parentPhone = row['Parent Phone']?.trim()
    const streetAddress = row['Street Address']?.trim()
    const city = row['City']?.trim()
    const state = row['State']?.trim()
    const zipCode = row['Zip Code']?.trim()
    const schoolNameInput = row['School']?.trim()
    const notes = row['Notes']?.trim()

    if (!fullName || !grade || !ageRaw || !parentName || !parentPhone || !streetAddress || !city || !state || !zipCode) {
      return { ok: false, message: 'Full Name, Grade, Age, Parent Name, Parent Phone, Street Address, City, State and Zip Code are all required' }
    }
    const school = (schoolsQuery.data ?? []).find((s) => s.name.toLowerCase() === schoolNameInput?.toLowerCase())
    if (!school) {
      return { ok: false, message: `School "${schoolNameInput ?? ''}" not found. Add it first via the form, then re-import` }
    }
    try {
      await api.post('/students', {
        full_name: fullName, grade, age: Number(ageRaw), parent_name: parentName, parent_phone: parentPhone,
        street_address: streetAddress, city, state, zip_code: zipCode, notes: notes || undefined, school_id: school.id,
      })
      return { ok: true, message: 'Created' }
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Import failed' }
    }
  }

  const invalidateStudents = () => {
    queryClient.invalidateQueries({ queryKey: ['students'] })
    queryClient.invalidateQueries({ queryKey: ['assignments'] })
  }

  // Reconciles the real Assignment for a student against what the form wants: closes the
  // previous active assignment (end_date = today) if one existed and is being replaced or
  // cleared, then opens a new one if a driver+van are both set. No-ops if nothing changed.
  async function syncAssignment(studentId: string, current: Assignment | null) {
    const today = new Date().toISOString().slice(0, 10)
    const wantsAssignment = Boolean(driverUserId && vanId)
    const unchanged = current && wantsAssignment && current.driver_user_id === driverUserId && current.van_id === vanId
    if (unchanged) return
    if (current) await api.patch(`/assignments/${current.id}`, { end_date: today })
    if (wantsAssignment) {
      await api.post('/assignments', { student_id: studentId, driver_user_id: driverUserId, van_id: vanId, start_date: today })
    }
  }

  const createStudent = useMutation({
    mutationFn: async () => {
      const [primary, ...extra] = guardians
      const extraFilled = extra.filter((g) => g.name.trim() || g.phone.trim())
      const incomplete = extraFilled.find((g) => !g.name.trim() || !g.phone.trim())
      if (incomplete) throw new ApiError(400, 'Each additional parent/guardian needs both a name and a phone number.')
      if (Boolean(driverUserId) !== Boolean(vanId)) {
        throw new ApiError(400, 'Pick both a driver and a van to create a real assignment, or leave both blank.')
      }

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
      if (driverUserId && vanId) {
        await api.post('/assignments', {
          student_id: student.id, driver_user_id: driverUserId, van_id: vanId, start_date: new Date().toISOString().slice(0, 10),
        })
      }
      return student
    },
    onSuccess: (student) => {
      invalidateStudents()
      if (schoolMode === 'new') queryClient.invalidateQueries({ queryKey: ['schools'] })
      setFormMsg(`Added ${student.full_name}.`)
      resetForm()
      checkForParentMatch(student)
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Could not create student.'),
  })

  const updateStudent = useMutation({
    mutationFn: async (id: string) => {
      if (Boolean(driverUserId) !== Boolean(vanId)) {
        throw new ApiError(400, 'Pick both a driver and a van to create a real assignment, or leave both blank.')
      }
      const student = await api.patch<Student>(`/students/${id}`, {
        full_name: fullName,
        grade,
        age: Number(age),
        parent_name: guardians[0].name,
        parent_phone: guardians[0].phone,
        street_address: streetAddress,
        city,
        state: stateCode,
        zip_code: zipCode,
        notes: notes || null,
      })
      await syncAssignment(id, currentAssignmentFor(id))
      return student
    },
    onSuccess: (student) => {
      invalidateStudents()
      setFormMsg('Changes saved.')
      resetForm()
      checkForParentMatch(student)
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-headline-lg text-primary">Students</h1>
        <div className="flex items-center gap-3">
          <CsvImportExport
            entityName="Students"
            columns={csvColumns}
            rows={studentsQuery.data ?? []}
            onImportRow={handleImportRow}
            onImportComplete={invalidateStudents}
          />
          <Button type="button" onClick={startAdd} className="flex items-center gap-1">
            <span className="material-symbols-outlined !text-[18px]">person_add</span>
            Add a Student
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 flex flex-col overflow-hidden">
          <CardHeader>
            <h2 className="text-title-lg text-primary">All Students</h2>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr>
                  {['Student', 'Driver', 'School', 'Grade', 'Address', 'Parent/Guardian', 'Phone', ''].map((h) => (
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
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">
                        {driversQuery.isLoading || assignmentsQuery.isLoading
                          ? '…'
                          : (driverName(currentAssignmentFor(s.id)?.driver_user_id ?? null) ?? '(no driver assigned)')}
                      </td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">
                        {schoolsQuery.isLoading ? '…' : schoolName(s.school_id)}
                      </td>
                      <td className="px-6 py-3 text-data-mono text-secondary">{s.grade ?? '-'}</td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">
                        {s.street_address ? `${s.street_address}, ${s.city}, ${s.state} ${s.zip_code}` : '-'}
                      </td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">{s.parent_name ?? '-'}</td>
                      <td className="px-6 py-3 text-data-mono text-secondary">
                        <ContactLink type="phone" value={s.parent_phone} />
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

      </div>

      {showModal && (
        <Modal title={editingId ? 'Edit Student' : 'Add a Student'} onClose={resetForm}>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <Input required placeholder="Full name (as it should appear in the app)" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <div className="flex gap-2">
              <Input required placeholder="Grade (e.g. 3)" value={grade} onChange={(e) => setGrade(e.target.value)} />
              <Input required type="number" placeholder="Age (years)" value={age} onChange={(e) => setAge(e.target.value)} />
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

            <div className="flex flex-col gap-1">
              <p className="text-label-md text-on-surface-variant">
                Assign a driver + van (optional: creates a real Assignment, both required together). Picking a
                driver narrows the van to whichever one they're already driving, if any.
              </p>
              <div className="flex gap-2">
                <select value={driverUserId} onChange={(e) => handleDriverSelect(e.target.value)} className={selectClass}>
                  <option value="">Driver…</option>
                  {(driversQuery.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name}
                    </option>
                  ))}
                </select>
                <select value={vanId} onChange={(e) => setVanId(e.target.value)} disabled={!!lockedVanId} className={selectClass}>
                  <option value="">Van…</option>
                  {(vansQuery.data ?? [])
                    .filter((v) => (lockedVanId ? v.id === lockedVanId : !excludedVanIds.has(v.id)))
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.license_plate}
                      </option>
                    ))}
                </select>
              </div>
              {lockedVanId && (
                <p className="text-label-md text-on-surface-variant">
                  This driver is currently driving {vansQuery.data?.find((v) => v.id === lockedVanId)?.license_plate ?? 'this van'}, locked to match.
                </p>
              )}
            </div>

            <Input required placeholder="Street address" value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} />
            <div className="flex gap-2">
              <Input required placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
              <div className="w-32 flex-none">
                <StateAutocomplete required value={stateCode} onChange={setStateCode} />
              </div>
              <Input required placeholder="Zip code" value={zipCode} onChange={(e) => setZipCode(e.target.value)} />
            </div>

            <textarea
              required
              placeholder="Notes: e.g. needs help buckling, needs a monitor. Enter 'None' if there's nothing to flag."
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
                      {schoolsQuery.isLoading ? 'Loading schools…' : 'No known schools yet. Switch to "New school" to add one.'}
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
                      required
                      placeholder="School address (street, city, state, zip)"
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
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            </div>
            {formMsg && <p className="text-body-md text-on-surface-variant">{formMsg}</p>}
            {formError && (
              <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">
                {formError}
              </p>
            )}
          </form>
        </Modal>
      )}

      {matchSuggestion && (
        <ParentMatchModal
          student={matchSuggestion.student}
          parent={matchSuggestion.parent}
          signals={matchSuggestion.signals}
          onClose={() => setMatchSuggestion(null)}
        />
      )}
    </div>
  )
}

// Confirmation prompt for an auto-detected parent<->student match (§ auto-match task). Never
// links anything until the admin explicitly says yes — see checkForParentMatch above for when
// this fires and client/src/lib/parentMatch.ts for the matching logic itself.
function ParentMatchModal({
  student,
  parent,
  signals,
  onClose,
}: {
  student: Student
  parent: PublicUser
  signals: string[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const studentAddress = [student.street_address, student.city, student.state, student.zip_code].filter(Boolean).join(', ')
  const missingPhone = !parent.phone && Boolean(student.parent_phone)
  const missingAddress = !parent.address && Boolean(studentAddress)
  const [fillPhone, setFillPhone] = useState(missingPhone)
  const [fillAddress, setFillAddress] = useState(missingAddress)
  const [error, setError] = useState<string | null>(null)

  const confirm = useMutation({
    mutationFn: async () => {
      await api.post<ParentStudentLink>('/parent-access', { parent_user_id: parent.id, student_id: student.id })
      const patch: Record<string, string> = {}
      if (fillPhone && missingPhone && student.parent_phone) patch.phone = student.parent_phone
      if (fillAddress && missingAddress && studentAddress) patch.address = studentAddress
      if (Object.keys(patch).length > 0) await api.patch(`/users/${parent.id}`, patch)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parent-access'] })
      queryClient.invalidateQueries({ queryKey: ['users', 'parent'] })
      onClose()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not link parent.'),
  })

  return (
    <Modal title="Possible Parent Match" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-body-lg text-on-surface">
          Is <strong>{parent.full_name}</strong> the parent/guardian of <strong>{student.full_name}</strong>?
        </p>
        <p className="text-label-md text-on-surface-variant">Matched on: {signals.join(', ')}.</p>

        {(missingPhone || missingAddress) && (
          <div className="flex flex-col gap-2 rounded-lg border border-outline-variant bg-surface-container p-3">
            <p className="text-label-md text-on-surface-variant">
              {parent.full_name}&rsquo;s account is missing info this student form just captured. Fill it in too?
            </p>
            {missingPhone && (
              <label className="flex items-center gap-2 text-body-md">
                <input
                  type="checkbox"
                  checked={fillPhone}
                  onChange={(e) => setFillPhone(e.target.checked)}
                  className="h-4 w-4 rounded border-outline text-primary focus:ring-primary-container"
                />
                Also set phone to {student.parent_phone}
              </label>
            )}
            {missingAddress && (
              <label className="flex items-center gap-2 text-body-md">
                <input
                  type="checkbox"
                  checked={fillAddress}
                  onChange={(e) => setFillAddress(e.target.checked)}
                  className="h-4 w-4 rounded border-outline text-primary focus:ring-primary-container"
                />
                Also set address to {studentAddress}
              </label>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            No
          </Button>
          <Button type="button" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
            {confirm.isPending ? 'Linking…' : 'Yes, link them'}
          </Button>
        </div>
      </div>
    </Modal>
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
                {c.phone ? (
                  <>
                    {' · '}
                    <ContactLink type="phone" value={c.phone} />
                  </>
                ) : (
                  ''
                )}
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
