import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { ContactLink } from '../../components/ContactLink'
import type { Student } from '../../types/api'

// School Admin — Students (§7.3): search/filter by name/grade, plus a Company placeholder
// creation panel. "Company linking" has no real join to perform (§4: the company<->school
// relationship is derived from Students.company_id, not a stateful link) — creating a
// placeholder is the one real action available here, mirroring company_admin's school
// placeholder flow.
export function StudentsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')

  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })

  const grades = useMemo(
    () => Array.from(new Set((studentsQuery.data ?? []).map((s) => s.grade).filter((g): g is string => Boolean(g)))).sort(),
    [studentsQuery.data],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (studentsQuery.data ?? []).filter((s) => {
      if (gradeFilter && s.grade !== gradeFilter) return false
      if (q && !s.full_name.toLowerCase().includes(q)) return false
      return true
    })
  }, [studentsQuery.data, search, gradeFilter])

  const [companyName, setCompanyName] = useState('')
  const [companyAddress, setCompanyAddress] = useState('')
  const [companyMsg, setCompanyMsg] = useState<string | null>(null)
  const [showAddCompanyModal, setShowAddCompanyModal] = useState(false)
  const createCompany = useMutation({
    mutationFn: () => api.post('/placeholders/company', { name: companyName, address: companyAddress }),
    onSuccess: () => {
      setCompanyMsg(`Placeholder created for "${companyName}". It'll appear once that company signs up and claims it.`)
      setCompanyName('')
      setCompanyAddress('')
      queryClient.invalidateQueries({ queryKey: ['students'] })
      setShowAddCompanyModal(false)
    },
    onError: (err) => setCompanyMsg(err instanceof ApiError ? err.message : 'Could not create placeholder.'),
  })

  function handleCreateCompany(e: FormEvent) {
    e.preventDefault()
    setCompanyMsg(null)
    createCompany.mutate()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-headline-lg text-primary">Students</h1>
        <Button type="button" onClick={() => setShowAddCompanyModal(true)} className="flex items-center gap-1">
          <span className="material-symbols-outlined !text-[18px]">add_business</span>
          Add a Company
        </Button>
      </div>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 flex flex-col overflow-hidden">
          <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-title-lg text-primary">All Students</h2>
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name…"
                className="h-10 w-48"
              />
              <select
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
                className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md outline-none focus:border-primary-container"
              >
                <option value="">All grades</option>
                {grades.map((g) => (
                  <option key={g} value={g}>
                    Grade {g}
                  </option>
                ))}
              </select>
            </div>
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
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-body-md text-on-surface-variant">
                      {studentsQuery.isLoading ? 'Loading…' : 'No students match.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((s) => (
                    <tr key={s.id} className="hover:bg-surface-container-low">
                      <td className="px-6 py-3 text-body-md font-medium">{s.full_name}</td>
                      <td className="px-6 py-3 text-data-mono text-secondary">{s.grade ?? '-'}</td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">{s.parent_name ?? '-'}</td>
                      <td className="px-6 py-3 text-data-mono text-secondary">
                        <ContactLink type="phone" value={s.parent_phone} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {showAddCompanyModal && (
        <Modal title="Add a Company" onClose={() => setShowAddCompanyModal(false)}>
          <p className="mb-3 text-body-md text-on-surface-variant">
            Not seeing the transportation company you work with? Create a placeholder. Once they sign up, they can
            claim it and the relationship shows up automatically through shared students.
          </p>
          <form className="flex flex-col gap-3" onSubmit={handleCreateCompany}>
            <Input required placeholder="Company name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            <Input required placeholder="Address (street, city, state, zip)" value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} />
            <div className="flex gap-2">
              <Button type="submit" variant="secondary" disabled={createCompany.isPending} className="flex-1">
                {createCompany.isPending ? 'Creating…' : 'Create Placeholder'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowAddCompanyModal(false)}>
                Cancel
              </Button>
            </div>
            {companyMsg && <p className="text-body-md text-on-surface-variant">{companyMsg}</p>}
          </form>
        </Modal>
      )}
    </div>
  )
}
