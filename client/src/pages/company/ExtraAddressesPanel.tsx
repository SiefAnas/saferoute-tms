import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Button } from '../../components/Button'
import { DrawerSection } from '../../components/Drawer'
import { InlineEmpty } from '../../components/EmptyState'
import { Field, Input, Select } from '../../components/Input'
import { WeekdayPicker } from '../../components/WeekdayPicker'
import { AddressText } from '../../components/AddressText'
import { extraAddressSchedule } from '../../components/Route'
import type { ExtraAddress, Student } from '../../types/api'

type Draft = {
  label: string
  street_address: string
  city: string
  state: string
  zip_code: string
  days_of_week: number[]
  applies_to: ExtraAddress['applies_to']
  start_date: string
  end_date: string
}

const EMPTY: Draft = { label: '', street_address: '', city: '', state: '', zip_code: '', days_of_week: [5], applies_to: 'afternoon_dropoff', start_date: '', end_date: '' }

const fromRecord = (x: ExtraAddress): Draft => ({
  label: x.label,
  street_address: x.street_address,
  city: x.city ?? '',
  state: x.state ?? '',
  zip_code: x.zip_code ?? '',
  days_of_week: x.days_of_week,
  applies_to: x.applies_to,
  start_date: x.start_date ?? '',
  end_date: x.end_date ?? '',
})

// "Other addresses" on the student drawer (company admin): a different pickup or drop-off place
// on some weekdays, e.g. "Fridays: Grandparents". The server decides which one applies on a day
// and shows it to the driver and the parent, highlighted.
export function ExtraAddressesPanel({ studentId }: { studentId: string }) {
  const queryClient = useQueryClient()
  const studentQuery = useQuery({ queryKey: ['student', studentId], queryFn: () => api.get<Student>(`/students/${studentId}`) })
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['student', studentId] })
    queryClient.invalidateQueries({ queryKey: ['schedule-today'] })
  }
  const body = () => ({
    ...draft,
    city: draft.city || null,
    state: draft.state || null,
    zip_code: draft.zip_code || null,
    start_date: draft.start_date || null,
    end_date: draft.end_date || null,
  })
  const save = useMutation({
    mutationFn: () =>
      editingId === 'new'
        ? api.post<ExtraAddress>(`/students/${studentId}/addresses`, body())
        : api.patch<ExtraAddress>(`/students/${studentId}/addresses/${editingId}`, body()),
    onSuccess: () => {
      invalidate()
      setEditingId(null)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save the address.'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/students/${studentId}/addresses/${id}`),
    onSuccess: invalidate,
  })

  function open(x: ExtraAddress | null) {
    setError(null)
    setDraft(x ? fromRecord(x) : EMPTY)
    setEditingId(x ? x.id : 'new')
  }
  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    save.mutate()
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const list = studentQuery.data?.extra_addresses ?? []

  return (
    <DrawerSection title="Other addresses">
      {studentQuery.isLoading ? (
        <p className="text-[13px] text-muted">Loading…</p>
      ) : list.length === 0 && editingId === null ? (
        <InlineEmpty icon="alt_route" text="No other addresses. Add one when pickup or drop-off is somewhere else on some days (e.g. Fridays at the grandparents')." />
      ) : (
        list.map((x) =>
          editingId === x.id ? null : (
            <div key={x.id} className="flex items-start justify-between gap-2 border-b border-divider py-2 text-[14px]">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium text-ink">{x.label}</span>
                {x.address && <AddressText address={x.address} />}
                <span className="text-[12px] text-muted">{extraAddressSchedule(x)}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => open(x)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" className="text-danger-ink" onClick={() => remove.mutate(x.id)} disabled={remove.isPending}>
                  Remove
                </Button>
              </span>
            </div>
          ),
        )
      )}

      {editingId ? (
        <form className="mt-2 flex flex-col gap-3 rounded-m border border-line p-3" onSubmit={handleSubmit}>
          <Field label="Label">
            <Input required placeholder="Grandparents" value={draft.label} onChange={(e) => set('label', e.target.value)} />
          </Field>
          <Field label="Street address">
            <Input required placeholder="5 Pine Rd" value={draft.street_address} onChange={(e) => set('street_address', e.target.value)} />
          </Field>
          <div className="grid grid-cols-[1fr_90px_110px] gap-2">
            <Field label="City">
              <Input value={draft.city} onChange={(e) => set('city', e.target.value)} />
            </Field>
            <Field label="State">
              <Input placeholder="MA" value={draft.state} onChange={(e) => set('state', e.target.value)} />
            </Field>
            <Field label="Zip">
              <Input value={draft.zip_code} onChange={(e) => set('zip_code', e.target.value)} />
            </Field>
          </div>
          <WeekdayPicker value={draft.days_of_week} onChange={(v) => set('days_of_week', v)} />
          <Field label="Replaces">
            <Select value={draft.applies_to} onChange={(e) => set('applies_to', e.target.value as Draft['applies_to'])}>
              <option value="afternoon_dropoff">Afternoon drop-off (instead of home)</option>
              <option value="morning_pickup">Morning pickup (instead of home)</option>
              <option value="both">Both</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From (optional)">
              <Input type="date" value={draft.start_date} onChange={(e) => set('start_date', e.target.value)} />
            </Field>
            <Field label="Until (optional)">
              <Input type="date" value={draft.end_date} onChange={(e) => set('end_date', e.target.value)} />
            </Field>
          </div>
          {error && (
            <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : editingId === 'new' ? 'Add address' : 'Save'}
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" size="sm" className="mt-2 self-start" onClick={() => open(null)}>
          <span className="material-symbols-outlined !text-[18px]">add</span>
          Add address
        </Button>
      )}
    </DrawerSection>
  )
}
