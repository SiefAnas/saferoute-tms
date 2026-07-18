import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import type { Student } from '../../types/api'

// Company Admin — Student creation (§4/§9 frontend gap): POST /students is
// company_admin-only and stamps company_id from the caller, but still needs a school_id
// (the other half of the dual-tenant row). There is no GET /schools endpoint (schools are
// root tenant entities with no cross-tenant read exposed to company_admin), so an existing
// school can only be offered here as "whichever school_id already appears on one of this
// company's students" — no name, since none is available. For a genuinely new school, this
// creates an unclaimed placeholder first (mirrors school_admin's "Add a Company" panel) and
// uses its id, which DOES come back with a name from POST /placeholders/school.
export function CompanyStudentsPage() {
  const queryClient = useQueryClient()
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })

  const knownSchools = useMemo(() => {
    const byId = new Map<string, number>()
    for (const s of studentsQuery.data ?? []) byId.set(s.school_id, (byId.get(s.school_id) ?? 0) + 1)
    return Array.from(byId.entries()).map(([id, count]) => ({ id, count }))
  }, [studentsQuery.data])

  const [fullName, setFullName] = useState('')
  const [grade, setGrade] = useState('')
  const [parentName, setParentName] = useState('')
  const [parentPhone, setParentPhone] = useState('')

  const [schoolMode, setSchoolMode] = useState<'existing' | 'new'>('existing')
  const [schoolId, setSchoolId] = useState('')
  const [newSchoolName, setNewSchoolName] = useState('')
  const [newSchoolAddress, setNewSchoolAddress] = useState('')

  const [formError, setFormError] = useState<string | null>(null)
  const [formMsg, setFormMsg] = useState<string | null>(null)

  function resetForm() {
    setFullName('')
    setGrade('')
    setParentName('')
    setParentPhone('')
    setNewSchoolName('')
    setNewSchoolAddress('')
    setSchoolId('')
  }

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
        school_id: targetSchoolId,
      })
    },
    onSuccess: (student) => {
      queryClient.invalidateQueries({ queryKey: ['students'] })
      setFormMsg(`Added ${student.full_name}.`)
      resetForm()
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Could not create student.'),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFormMsg(null)
    createStudent.mutate()
  }

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
                  {['Name', 'Grade', 'Parent/Guardian', 'Phone'].map((h) => (
                    <th key={h} className="px-6 py-2 text-label-md text-secondary uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {(studentsQuery.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-body-md text-on-surface-variant">
                      {studentsQuery.isLoading ? 'Loading…' : 'No students yet.'}
                    </td>
                  </tr>
                ) : (
                  (studentsQuery.data ?? []).map((s) => (
                    <tr key={s.id} className="hover:bg-surface-container-low">
                      <td className="px-6 py-3 text-body-md font-medium">{s.full_name}</td>
                      <td className="px-6 py-3 text-data-mono text-secondary">{s.grade ?? '—'}</td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">{s.parent_name ?? '—'}</td>
                      <td className="px-6 py-3 text-data-mono text-secondary">{s.parent_phone ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="col-span-12 p-5 lg:col-span-4">
          <h2 className="mb-3 text-title-lg text-primary">Add a Student</h2>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <Input required placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <Input placeholder="Grade (optional)" value={grade} onChange={(e) => setGrade(e.target.value)} />
            <Input
              placeholder="Parent/guardian name (optional)"
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
            />
            <Input
              placeholder="Parent/guardian phone (optional)"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
            />

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
              knownSchools.length === 0 ? (
                <p className="text-body-md text-on-surface-variant">
                  No known schools yet — switch to "New school" to add one.
                </p>
              ) : (
                <select required value={schoolId} onChange={(e) => setSchoolId(e.target.value)} className={selectClass}>
                  <option value="">Select a school…</option>
                  {knownSchools.map((s) => (
                    <option key={s.id} value={s.id}>
                      School {s.id.slice(0, 8)}… ({s.count} student{s.count === 1 ? '' : 's'})
                    </option>
                  ))}
                </select>
              )
            ) : (
              <>
                <Input
                  required
                  placeholder="School name"
                  value={newSchoolName}
                  onChange={(e) => setNewSchoolName(e.target.value)}
                />
                <Input
                  placeholder="School address (optional)"
                  value={newSchoolAddress}
                  onChange={(e) => setNewSchoolAddress(e.target.value)}
                />
              </>
            )}

            <Button type="submit" variant="secondary" disabled={createStudent.isPending}>
              {createStudent.isPending ? 'Adding…' : 'Add Student'}
            </Button>
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
