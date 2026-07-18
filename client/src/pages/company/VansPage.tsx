import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import type { Van } from '../../types/api'

// Company Admin — Fleet management (§6/§9 frontend gap): create/edit/delete vans.
// Shares the ['vans'] query key with CompanyAdminDashboard's Fleet card, so changes here
// show up there without extra wiring.
export function VansPage() {
  const queryClient = useQueryClient()
  const vansQuery = useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })

  const [editingId, setEditingId] = useState<string | null>(null)
  const [licensePlate, setLicensePlate] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  function resetForm() {
    setEditingId(null)
    setLicensePlate('')
    setModel('')
    setYear('')
    setFormError(null)
  }

  function startEdit(van: Van) {
    setEditingId(van.id)
    setLicensePlate(van.license_plate)
    setModel(van.model ?? '')
    setYear(van.year ? String(van.year) : '')
    setFormError(null)
  }

  const invalidateVans = () => queryClient.invalidateQueries({ queryKey: ['vans'] })

  const createVan = useMutation({
    mutationFn: () =>
      api.post<Van>('/vans', { license_plate: licensePlate, model: model || undefined, year: year ? Number(year) : undefined }),
    onSuccess: () => {
      invalidateVans()
      resetForm()
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Could not create van.'),
  })

  const updateVan = useMutation({
    mutationFn: (id: string) =>
      api.patch<Van>(`/vans/${id}`, { license_plate: licensePlate, model: model || null, year: year ? Number(year) : null }),
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
                  {['Plate', 'Model', 'Year', ''].map((h) => (
                    <th key={h} className="px-6 py-2 text-label-md text-secondary uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {(vansQuery.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-body-md text-on-surface-variant">
                      {vansQuery.isLoading ? 'Loading…' : 'No vans yet.'}
                    </td>
                  </tr>
                ) : (
                  (vansQuery.data ?? []).map((van) => (
                    <tr key={van.id} className="hover:bg-surface-container-low">
                      <td className="px-6 py-3 text-data-mono font-medium">{van.license_plate}</td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">{van.model ?? '—'}</td>
                      <td className="px-6 py-3 text-data-mono text-secondary">{van.year ?? '—'}</td>
                      <td className="px-6 py-3 text-right">
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="col-span-12 p-5 lg:col-span-4">
          <h2 className="mb-3 text-title-lg text-primary">{editingId ? 'Edit Van' : 'Add a Van'}</h2>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <Input
              required
              placeholder="License plate"
              value={licensePlate}
              onChange={(e) => setLicensePlate(e.target.value)}
            />
            <Input placeholder="Model (optional)" value={model} onChange={(e) => setModel(e.target.value)} />
            <Input
              type="number"
              placeholder="Year (optional)"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
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
