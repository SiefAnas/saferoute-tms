import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { isAssignmentActiveToday } from '../../lib/format'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import type { Assignment, PublicUser, Van } from '../../types/api'

// Company Admin — Fleet management. Fleet page task (2026-08-27): brand/model split, color,
// and an assigned driver are all required at creation; plate/year are required too (no more
// "optional"). Table gained Brand/Color/Driver columns.
//
// Driver assignment rework (2026-08-27, later): vans no longer carry their own "assigned
// driver" field — that standalone tag could silently disagree with the real assignments
// table (also student+driver+van), so it was removed entirely. "Driver" here is now
// read-only, derived live from today's active assignment(s) using this van — same source of
// truth as the Students page, the driver's own schedule, and payroll. There's no inline way
// to set it from this page: "assign a driver to a van" would need to name a student too
// (a real Assignment can't exist with only two of its three legs), which doesn't fit a
// van-level action — use the Assignments page to actually create/change who's driving what.
export function VansPage() {
  const queryClient = useQueryClient()
  const vansQuery = useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })
  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
  const assignmentsQuery = useQuery({ queryKey: ['assignments'], queryFn: () => api.get<Assignment[]>('/assignments') })

  const driverName = useMemo(() => {
    const map = new Map((driversQuery.data ?? []).map((d) => [d.id, d.full_name]))
    return (id: string) => map.get(id) ?? null
  }, [driversQuery.data])

  // A van can legitimately have more than one driver active today (different students,
  // different assignments) — show every distinct driver currently using this van.
  const currentDriversFor = useMemo(() => {
    const byVan = new Map<string, Set<string>>()
    for (const a of assignmentsQuery.data ?? []) {
      if (!isAssignmentActiveToday(a.start_date, a.end_date)) continue
      if (!byVan.has(a.van_id)) byVan.set(a.van_id, new Set())
      byVan.get(a.van_id)!.add(a.driver_user_id)
    }
    return (vanId: string) =>
      Array.from(byVan.get(vanId) ?? [])
        .map(driverName)
        .filter((n): n is string => Boolean(n))
  }, [assignmentsQuery.data, driverName])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [licensePlate, setLicensePlate] = useState('')
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [color, setColor] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  function resetForm() {
    setEditingId(null)
    setLicensePlate('')
    setBrand('')
    setModel('')
    setYear('')
    setColor('')
    setFormError(null)
  }

  function startEdit(van: Van) {
    setEditingId(van.id)
    setLicensePlate(van.license_plate)
    setBrand(van.brand)
    setModel(van.model)
    setYear(String(van.year))
    setColor(van.color ?? '')
    setFormError(null)
  }

  const invalidateVans = () => queryClient.invalidateQueries({ queryKey: ['vans'] })

  const vanPayload = () => ({
    license_plate: licensePlate,
    brand,
    model,
    year: Number(year),
    color,
  })

  const createVan = useMutation({
    mutationFn: () => api.post<Van>('/vans', vanPayload()),
    onSuccess: () => {
      invalidateVans()
      resetForm()
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Could not create van.'),
  })

  const updateVan = useMutation({
    mutationFn: (id: string) => api.patch<Van>(`/vans/${id}`, vanPayload()),
    onSuccess: () => {
      invalidateVans()
      resetForm()
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Could not update van.'),
  })

  const deleteVan = useMutation({
    mutationFn: (id: string) => api.delete(`/vans/${id}`),
    onSuccess: () => {
      invalidateVans()
      if (editingId) resetForm()
    },
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (editingId) updateVan.mutate(editingId)
    else createVan.mutate()
  }

  const saving = createVan.isPending || updateVan.isPending

  const columns: Array<{ label: string; icon: string }> = [
    { label: 'Plate', icon: 'pin' },
    { label: 'Brand', icon: 'sell' },
    { label: 'Model', icon: 'directions_car' },
    { label: 'Year', icon: 'calendar_month' },
    { label: 'Color', icon: 'palette' },
    { label: 'Driver', icon: 'person' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">Fleet</h1>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-8">
          <CardHeader>
            <h2 className="text-title-lg text-primary">Vans</h2>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr>
                  {columns.map((c) => (
                    <th key={c.label} className="px-6 py-2 text-label-md text-secondary uppercase">
                      <span className="inline-flex items-center gap-1">
                        <span className="material-symbols-outlined !text-[16px]">{c.icon}</span>
                        {c.label}
                      </span>
                    </th>
                  ))}
                  <th className="px-6 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {(vansQuery.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-4 text-body-md text-on-surface-variant">
                      {vansQuery.isLoading ? 'Loading…' : 'No vans yet.'}
                    </td>
                  </tr>
                ) : (
                  (vansQuery.data ?? []).map((van) => {
                    const drivers = currentDriversFor(van.id)
                    return (
                      <tr key={van.id} className="hover:bg-surface-container-low">
                        <td className="px-6 py-3 text-data-mono font-medium">{van.license_plate}</td>
                        <td className="px-6 py-3 text-body-md text-on-surface-variant">{van.brand}</td>
                        <td className="px-6 py-3 text-body-md text-on-surface-variant">{van.model}</td>
                        <td className="px-6 py-3 text-data-mono text-secondary">{van.year}</td>
                        <td className="px-6 py-3 text-body-md text-on-surface-variant">{van.color ?? '—'}</td>
                        <td className="px-6 py-3 text-body-md text-on-surface-variant">
                          {driversQuery.isLoading || assignmentsQuery.isLoading
                            ? '…'
                            : drivers.length
                              ? drivers.join(', ')
                              : '(no driver assigned)'}
                        </td>
                        <td className="px-6 py-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => startEdit(van)}
                            className="mr-3 text-label-md text-primary hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteVan.mutate(van.id)}
                            disabled={deleteVan.isPending}
                            className="text-label-md text-error hover:underline disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="col-span-12 p-5 lg:col-span-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-title-lg text-primary">{editingId ? 'Edit Van' : 'Add a Van'}</h2>
            <span className="material-symbols-outlined text-secondary">local_shipping</span>
          </div>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <Input required placeholder="License plate" value={licensePlate} onChange={(e) => setLicensePlate(e.target.value)} />
            <div className="flex gap-2">
              <Input required placeholder="Brand (e.g. Ford)" value={brand} onChange={(e) => setBrand(e.target.value)} />
              <Input required placeholder="Model (e.g. Transit SE)" value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Input required type="number" placeholder="Year" value={year} onChange={(e) => setYear(e.target.value)} />
              <Input required placeholder="Color" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
            <p className="text-label-md text-on-surface-variant">
              To assign a driver to this van, create or edit an Assignment on the Assignments page — "Driver" above
              reflects whichever assignment is active today, it isn't set here.
            </p>
            <div className="flex gap-2">
              <Button type="submit" variant="secondary" disabled={saving} className="flex-1">
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Van'}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
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
