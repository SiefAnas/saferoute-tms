import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { isAssignmentActiveToday } from '../../lib/format'
import { Button } from '../../components/Button'
import { Field, Input } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { Drawer, DetailRows } from '../../components/Drawer'
import { EmptyState } from '../../components/EmptyState'
import { StatusBadge, type BadgeTone } from '../../components/StatusBadge'
import { CsvImportExport } from '../../components/CsvImportExport'
import { NameCell, NoMatches, PageIntro, SearchField, StatCard, StatRow, TableCard, TableRow, matches } from '../../components/Records'
import { useToast } from '../../components/Toast'
import { PageTopBar } from '../../layouts/TopBar'
import type { CsvColumn } from '../../lib/csv'
import type { Assignment, DriverSession, PublicUser, Van } from '../../types/api'

const CSV_COLUMNS: CsvColumn<Van>[] = [
  { key: 'license_plate', header: 'License Plate' },
  { key: 'brand', header: 'Brand' },
  { key: 'model', header: 'Model' },
  { key: 'year', header: 'Year' },
  { key: 'color', header: 'Color' },
]

const TEMPLATE = '2fr 1fr 1fr 1.4fr 1fr'

// Company Admin — Fleet (design 5a records template).
//
// A van's "driver" is read-only here, derived from today's active assignment(s) using the van —
// same source of truth as the Students page, the driver's own schedule and payroll. Vans don't
// carry their own driver field (that tag could silently disagree with assignments and was
// removed on purpose); who drives what is set on the Assignments page.
export function VansPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const vansQuery = useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })
  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
  const assignmentsQuery = useQuery({ queryKey: ['assignments'], queryFn: () => api.get<Assignment[]>('/assignments') })
  const sessionsQuery = useQuery({ queryKey: ['sessions', 'all'], queryFn: () => api.get<DriverSession[]>('/sessions') })

  const [q, setQ] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // A van can have more than one driver active today (different students, or a morning and an
  // afternoon driver sharing it). Each distinct driver is listed, labeled by shift when their use
  // of this van is confined to one shift.
  const rows = useMemo(() => {
    const names = new Map((driversQuery.data ?? []).map((d) => [d.id, d.full_name]))
    const onShift = new Set((sessionsQuery.data ?? []).filter((s) => s.check_out_at === null).map((s) => s.user_id))
    const byVan = new Map<string, Map<string, Set<string>>>()
    for (const a of assignmentsQuery.data ?? []) {
      if (!isAssignmentActiveToday(a.start_date, a.end_date)) continue
      if (!byVan.has(a.van_id)) byVan.set(a.van_id, new Map())
      const drivers = byVan.get(a.van_id)!
      if (!drivers.has(a.driver_user_id)) drivers.set(a.driver_user_id, new Set())
      drivers.get(a.driver_user_id)!.add(a.shift_period)
    }
    return (vansQuery.data ?? []).map((van) => {
      const drivers = [...(byVan.get(van.id) ?? new Map<string, Set<string>>())].flatMap(([id, shifts]) => {
        const name = names.get(id)
        if (!name) return []
        const onlyOne = shifts.size === 1 && !shifts.has('both')
        return [{ id, name, shift: onlyOne ? (shifts.has('afternoon') ? 'Afternoon' : 'Morning') : null }]
      })
      const moving = drivers.some((d) => onShift.has(d.id))
      const status: { label: string; tone: BadgeTone } = drivers.length === 0
        ? { label: 'No driver', tone: 'caution' }
        : moving
          ? { label: 'On the road', tone: 'success' }
          : { label: 'Parked', tone: 'neutral' }
      return { van, drivers, status }
    })
  }, [vansQuery.data, driversQuery.data, assignmentsQuery.data, sessionsQuery.data])

  // ---- Add / edit ----
  const [editingId, setEditingId] = useState<string | null>(null)
  const [licensePlate, setLicensePlate] = useState('')
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [color, setColor] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  function resetForm() {
    setEditingId(null)
    setLicensePlate('')
    setBrand('')
    setModel('')
    setYear('')
    setColor('')
    setFormError(null)
    setShowModal(false)
  }

  function startAdd() {
    resetForm()
    setShowModal(true)
  }

  function startEdit(van: Van) {
    setEditingId(van.id)
    setLicensePlate(van.license_plate)
    setBrand(van.brand)
    setModel(van.model)
    setYear(String(van.year))
    setColor(van.color ?? '')
    setFormError(null)
    setShowModal(true)
  }

  const invalidateVans = () => queryClient.invalidateQueries({ queryKey: ['vans'] })

  const vanPayload = () => ({ license_plate: licensePlate, brand, model, year: Number(year), color })

  const createVan = useMutation({
    mutationFn: () => api.post<Van>('/vans', vanPayload()),
    onSuccess: (van) => {
      invalidateVans()
      resetForm()
      toast.show(`${van.brand} ${van.model} (${van.license_plate}) added`)
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Could not create van.'),
  })

  const updateVan = useMutation({
    mutationFn: (id: string) => api.patch<Van>(`/vans/${id}`, vanPayload()),
    onSuccess: () => {
      invalidateVans()
      resetForm()
      toast.show('Van updated')
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Could not update van.'),
  })

  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteVan = useMutation({
    mutationFn: (id: string) => api.delete(`/vans/${id}`),
    onSuccess: () => {
      invalidateVans()
      setDetailId(null)
      setConfirmDelete(false)
      toast.show('Van deleted')
    },
    onError: (err) => setDeleteError(err instanceof ApiError ? err.message : 'Could not delete this van.'),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (editingId) updateVan.mutate(editingId)
    else createVan.mutate()
  }

  // CSV import (2026-08-28): upsert by license plate, per the task's own matching rule for
  // vans.
  async function handleImportRow(row: Record<string, string>) {
    const plate = row['License Plate']?.trim()
    if (!plate) return { ok: false, message: 'License Plate is required' }
    const brand = row['Brand']?.trim()
    const model = row['Model']?.trim()
    const yearRaw = row['Year']?.trim()
    const color = row['Color']?.trim()

    const existing = (vansQuery.data ?? []).find((v) => v.license_plate.toLowerCase() === plate.toLowerCase())
    try {
      if (existing) {
        const patch: Record<string, unknown> = {}
        if (brand) patch.brand = brand
        if (model) patch.model = model
        if (yearRaw) patch.year = Number(yearRaw)
        if (color) patch.color = color
        if (Object.keys(patch).length === 0) return { ok: true, message: 'No changes' }
        await api.patch(`/vans/${existing.id}`, patch)
        return { ok: true, message: 'Updated' }
      }
      if (!brand || !model || !yearRaw || !color) {
        return { ok: false, message: 'Brand, Model, Year and Color are all required for a new van' }
      }
      await api.post('/vans', { license_plate: plate, brand, model, year: Number(yearRaw), color })
      return { ok: true, message: 'Created' }
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Import failed' }
    }
  }

  const saving = createVan.isPending || updateVan.isPending
  const inService = rows.filter((r) => r.drivers.length > 0)
  const onRoad = rows.filter((r) => r.status.label === 'On the road')
  const noDriver = rows.filter((r) => r.drivers.length === 0)
  const visible = rows.filter((r) =>
    matches(q, r.van.license_plate, r.van.brand, r.van.model, r.van.color, String(r.van.year), ...r.drivers.map((d) => d.name)),
  )
  const detail = rows.find((r) => r.van.id === detailId) ?? null
  const driverText = (r: (typeof rows)[number]) =>
    r.drivers.length ? r.drivers.map((d) => (d.shift ? `${d.name} (${d.shift})` : d.name)).join(', ') : '—'

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="Fleet">
        <SearchField value={q} onChange={setQ} placeholder="Search vans" />
        <CsvImportExport entityName="Fleet" columns={CSV_COLUMNS} rows={vansQuery.data ?? []} onImportRow={handleImportRow} onImportComplete={invalidateVans} />
        <Button onClick={startAdd}>
          <span className="material-symbols-outlined !text-[18px]">add</span>
          Add van
        </Button>
      </PageTopBar>

      <PageIntro>Every van, its plate and who drives it.</PageIntro>

      <StatRow>
        <StatCard label="Vans" value={rows.length} sub={`${inService.length} in service today`} />
        <StatCard label="On the road now" value={onRoad.length} tone={onRoad.length ? 'success' : 'default'} sub="With a checked-in driver" />
        <StatCard
          label="No driver assigned"
          value={noDriver.length}
          tone={noDriver.length ? 'caution' : 'default'}
          sub={noDriver.length ? noDriver.map((r) => r.van.license_plate).join(', ') : 'Every van has a driver today'}
        />
      </StatRow>

      <TableCard template={TEMPLATE} columns={[{ label: 'Van' }, { label: 'Plate' }, { label: 'Color' }, { label: 'Assigned driver' }, { label: 'Status' }]}>
        {vansQuery.isLoading ? (
          <p className="border-t border-divider px-5 py-4 text-[14px] text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="local_shipping"
            title="No vans yet"
            body="Add your first van, then assign it to a driver on the Assignments page."
            action={<Button onClick={startAdd}>Add van</Button>}
          />
        ) : visible.length === 0 ? (
          <NoMatches q={q} hint="Search looks at plates, makes, models, colors and drivers." onClear={() => setQ('')} />
        ) : (
          visible.map((r) => (
            <TableRow key={r.van.id} template={TEMPLATE} selected={detailId === r.van.id} onClick={() => setDetailId(r.van.id)}>
              <NameCell avatar={false} name={`${r.van.brand} ${r.van.model}`} sub={String(r.van.year)} />
              <span className="font-medium text-ink-sub tabular">{r.van.license_plate}</span>
              <span className="text-ink-sub">{r.van.color ?? '—'}</span>
              <span className="truncate text-ink-sub">{driversQuery.isLoading || assignmentsQuery.isLoading ? '…' : driverText(r)}</span>
              <span>
                <StatusBadge tone={r.status.tone} label={r.status.label} />
              </span>
            </TableRow>
          ))
        )}
      </TableCard>

      {detail && (
        <Drawer
          eyebrow="DETAILS"
          title={`${detail.van.brand} ${detail.van.model}`}
          subtitle={`${detail.van.license_plate} · ${detail.van.year}`}
          onClose={() => {
            setDetailId(null)
            setConfirmDelete(false)
            setDeleteError(null)
          }}
          footer={
            confirmDelete ? (
              <div className="flex flex-col gap-2">
                <span className="text-[13px] text-ink">Delete {detail.van.license_plate}? This can&apos;t be undone.</span>
                {deleteError && <span className="text-[13px] text-alert-fg">{deleteError}</span>}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                    Keep van
                  </Button>
                  <Button variant="danger" disabled={deleteVan.isPending} onClick={() => deleteVan.mutate(detail.van.id)}>
                    {deleteVan.isPending ? 'Deleting…' : 'Delete van'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-between gap-2">
                <Button variant="ghost" className="text-danger-ink" onClick={() => setConfirmDelete(true)}>
                  <span className="material-symbols-outlined !text-[18px]">delete</span>
                  Delete
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => startEdit(detail.van)}>
                    <span className="material-symbols-outlined !text-[18px]">edit</span>
                    Edit
                  </Button>
                  <Button onClick={() => setDetailId(null)}>Done</Button>
                </div>
              </div>
            )
          }
        >
          <DetailRows
            rows={[
              { k: 'Status', v: <StatusBadge tone={detail.status.tone} label={detail.status.label} /> },
              { k: 'Plate', v: detail.van.license_plate },
              { k: 'Make & model', v: `${detail.van.brand} ${detail.van.model}` },
              { k: 'Year', v: detail.van.year },
              { k: 'Color', v: detail.van.color ?? '—' },
              { k: 'Drivers today', v: driverText(detail) },
            ]}
          />
          <p className="text-[13px] text-muted">Who drives this van comes from today&apos;s assignments. Change it on the Assignments page.</p>
        </Drawer>
      )}

      {showModal && (
        <Modal title={editingId ? 'Edit van' : 'Add van'} onClose={resetForm}>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <Field label="License plate">
              <Input required placeholder="AAA-1234" value={licensePlate} onChange={(e) => setLicensePlate(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Make">
                <Input required placeholder="Ford" value={brand} onChange={(e) => setBrand(e.target.value)} />
              </Field>
              <Field label="Model">
                <Input required placeholder="Transit SE" value={model} onChange={(e) => setModel(e.target.value)} />
              </Field>
              <Field label="Year">
                <Input required type="number" placeholder="2022" value={year} onChange={(e) => setYear(e.target.value)} />
              </Field>
              <Field label="Color">
                <Input required placeholder="White" value={color} onChange={(e) => setColor(e.target.value)} />
              </Field>
            </div>
            <p className="text-[12px] text-muted">To put a driver on this van, create or edit an assignment on the Assignments page.</p>
            {formError && (
              <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
                {formError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add van'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {toast.node}
    </div>
  )
}
