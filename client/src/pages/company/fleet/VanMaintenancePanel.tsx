import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../../lib/api'
import { Button } from '../../../components/Button'
import { DrawerSection } from '../../../components/Drawer'
import { Field, Input, Select } from '../../../components/Input'
import { StatusBadge } from '../../../components/StatusBadge'
import type { FuelEntry, MaintenanceItem, MaintenanceRecord, VanMaintenance } from '../../../types/api'
import { dueLine, miles, shortDate, stateBadge } from './fleetText'

const errText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)
const num = (s: string) => (s.trim() === '' ? null : Number(s))

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
      {error}
    </p>
  )
}

// The van drawer's maintenance + fuel sections (company admin). Items by date or by mileage,
// Done (keeps a record, starts the next cycle), edit, turn off, delete, custom items, this van's
// reminder timing, the history of every Done, and the fuel / odometer log.
export function VanMaintenancePanel({ vanId }: { vanId: string }) {
  const q = useQuery({ queryKey: ['fleet', 'van', vanId], queryFn: () => api.get<VanMaintenance>(`/fleet/vans/${vanId}/maintenance`) })
  if (q.isLoading) return <p className="text-[13px] text-muted">Loading maintenance…</p>
  if (!q.data) return <ErrorLine error="Could not load maintenance." />
  const m = q.data
  return (
    <>
      <DrawerSection title="Maintenance">
        <p className="text-[13px] text-muted">
          Odometer: <b className="font-semibold text-ink">{miles(m.current_miles)}</b>
          {m.current_miles_date ? ` (${shortDate(m.current_miles_date)})` : ' · no reading yet'}
        </p>
        <ul className="flex flex-col divide-y divide-divider rounded-row border border-line">
          {m.items.map((i) => (
            <ItemRow key={i.id} vanId={vanId} item={i} currentMiles={m.current_miles} />
          ))}
        </ul>
        <AddItemForm vanId={vanId} />
      </DrawerSection>
      <RemindersSection vanId={vanId} m={m} />
      <HistorySection vanId={vanId} />
      <FuelSection vanId={vanId} />
    </>
  )
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: ['fleet'] })
}

function ItemRow({ vanId, item, currentMiles }: { vanId: string; item: MaintenanceItem; currentMiles: number | null }) {
  const invalidate = useInvalidate()
  const [mode, setMode] = useState<'view' | 'done' | 'edit' | 'delete'>('view')
  const [error, setError] = useState<string | null>(null)
  const badge = stateBadge(item)
  const base = `/fleet/vans/${vanId}/maintenance/${item.id}`
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(base, body),
    onSuccess: () => {
      setMode('view')
      invalidate()
    },
    onError: (err) => setError(errText(err, 'Could not save.')),
  })
  const remove = useMutation({
    mutationFn: () => api.delete(base),
    onSuccess: invalidate,
    onError: (err) => setError(errText(err, 'Could not delete.')),
  })

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[14px] font-medium text-ink">
            {item.name}
            <span className="ml-1.5 text-[12px] font-normal text-muted">
              {item.schedule_type === 'date'
                ? item.interval_days
                  ? `· every ${item.interval_days} days`
                  : '· by date'
                : item.interval_miles
                  ? `· every ${item.interval_miles.toLocaleString()} mi`
                  : '· by mileage'}
            </span>
          </span>
          <span className="text-[13px] text-muted">{dueLine(item)}</span>
        </span>
        {badge && <StatusBadge tone={badge.tone} label={badge.label} />}
      </div>
      {mode === 'view' && (
        <div className="flex flex-wrap gap-1.5">
          {item.is_active && (
            <Button size="sm" onClick={() => setMode('done')}>
              <span className="material-symbols-outlined !text-[16px]">task_alt</span>
              Done
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setMode('edit')}>
            Edit
          </Button>
          <Button size="sm" variant="outline" disabled={patch.isPending} onClick={() => patch.mutate({ is_active: !item.is_active })}>
            {item.is_active ? 'Turn off' : 'Turn on'}
          </Button>
          <Button size="sm" variant="ghost" className="text-danger-ink" onClick={() => setMode('delete')}>
            Delete
          </Button>
        </div>
      )}
      {mode === 'done' && <DoneForm vanId={vanId} item={item} currentMiles={currentMiles} onClose={() => setMode('view')} />}
      {mode === 'edit' && <EditForm item={item} busy={patch.isPending} onCancel={() => setMode('view')} onSave={(body) => patch.mutate(body)} />}
      {mode === 'delete' && (
        <div className="flex flex-wrap items-center gap-2 rounded-row bg-surface-2 px-3 py-2 text-[13px]">
          <span className="flex-1">Remove {item.name} from this van? Its past records stay in the history.</span>
          <Button size="sm" variant="outline" onClick={() => setMode('view')}>
            Keep
          </Button>
          <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Delete
          </Button>
        </div>
      )}
      <ErrorLine error={error} />
    </li>
  )
}

function DoneForm({ vanId, item, currentMiles, onClose }: { vanId: string; item: MaintenanceItem; currentMiles: number | null; onClose: () => void }) {
  const invalidate = useInvalidate()
  const [date, setDate] = useState('')
  const [odometer, setOdometer] = useState(currentMiles === null ? '' : String(currentMiles))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const done = useMutation({
    mutationFn: () =>
      api.post(`/fleet/vans/${vanId}/maintenance/${item.id}/done`, {
        ...(date ? { done_date: date } : {}),
        odometer: num(odometer),
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      invalidate()
      onClose()
    },
    onError: (err) => setError(errText(err, 'Could not save.')),
  })
  return (
    <form
      className="flex flex-col gap-2 rounded-row bg-surface-2 p-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        setError(null)
        done.mutate()
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Done on (blank = today)">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Odometer (miles)">
          <Input type="number" min={0} required={item.schedule_type === 'mileage' && currentMiles === null} value={odometer} onChange={(e) => setOdometer(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <Input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Shop, invoice number…" />
      </Field>
      <p className="text-[12px] text-muted">
        {item.schedule_type === 'date'
          ? item.interval_days
            ? `Next due ${item.interval_days} days after this date.`
            : 'No repeat set: set the next date afterwards (Edit).'
          : item.interval_miles
            ? `Next due ${item.interval_miles.toLocaleString()} miles after this odometer reading.`
            : 'No repeat set: set the next mileage afterwards (Edit).'}{' '}
        This is kept in the history.
      </p>
      <ErrorLine error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={done.isPending}>
          {done.isPending ? 'Saving…' : 'Mark done'}
        </Button>
      </div>
    </form>
  )
}

function EditForm({ item, busy, onCancel, onSave }: { item: MaintenanceItem; busy: boolean; onCancel: () => void; onSave: (b: Record<string, unknown>) => void }) {
  const [name, setName] = useState(item.name)
  const [due, setDue] = useState(item.schedule_type === 'date' ? (item.due_date ?? '') : item.due_miles === null ? '' : String(item.due_miles))
  const [every, setEvery] = useState(String((item.schedule_type === 'date' ? item.interval_days : item.interval_miles) ?? ''))
  const isDate = item.schedule_type === 'date'
  return (
    <form
      className="flex flex-col gap-2 rounded-row bg-surface-2 p-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        onSave({
          ...(name.trim() !== item.name ? { name } : {}),
          ...(isDate ? { due_date: due || null, interval_days: num(every) } : { due_miles: num(due), interval_miles: num(every) }),
        })
      }}
    >
      <Field label="Name">
        <Input required value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={isDate ? 'Due date' : 'Due at (miles)'}>
          <Input type={isDate ? 'date' : 'number'} min={0} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label={isDate ? 'Repeats every (days)' : 'Repeats every (miles)'}>
          <Input type="number" min={1} value={every} onChange={(e) => setEvery(e.target.value)} placeholder="No repeat" />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          Save
        </Button>
      </div>
    </form>
  )
}

function AddItemForm({ vanId }: { vanId: string }) {
  const invalidate = useInvalidate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<'date' | 'mileage'>('mileage')
  const [due, setDue] = useState('')
  const [every, setEvery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const add = useMutation({
    mutationFn: () =>
      api.post(`/fleet/vans/${vanId}/maintenance`, {
        name,
        schedule_type: type,
        ...(type === 'date' ? { due_date: due || null, interval_days: num(every) } : { due_miles: num(due), interval_miles: num(every) }),
      }),
    onSuccess: () => {
      invalidate()
      setOpen(false)
      setName('')
      setDue('')
      setEvery('')
    },
    onError: (err) => setError(errText(err, 'Could not add.')),
  })
  if (!open) {
    return (
      <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
        <span className="material-symbols-outlined !text-[16px]">add</span>
        Add item
      </Button>
    )
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-row bg-surface-2 p-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        setError(null)
        add.mutate()
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name">
          <Input required value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Timing belt" />
        </Field>
        <Field label="Tracked by">
          <Select value={type} onChange={(e) => { setType(e.target.value as 'date' | 'mileage'); setDue('') }}>
            <option value="mileage">Mileage</option>
            <option value="date">Date</option>
          </Select>
        </Field>
        <Field label={type === 'date' ? 'Due date' : 'Due at (miles)'}>
          <Input type={type === 'date' ? 'date' : 'number'} min={0} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label={type === 'date' ? 'Repeats every (days)' : 'Repeats every (miles)'}>
          <Input type="number" min={1} value={every} onChange={(e) => setEvery(e.target.value)} placeholder={type === 'date' ? '365' : '20000'} />
        </Field>
      </div>
      <ErrorLine error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={add.isPending}>
          Add
        </Button>
      </div>
    </form>
  )
}

function RemindersSection({ vanId, m }: { vanId: string; m: VanMaintenance }) {
  const invalidate = useInvalidate()
  const [editing, setEditing] = useState(false)
  const [days, setDays] = useState(String(m.reminders.days_before))
  const [mi, setMi] = useState(String(m.reminders.miles_before))
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/fleet/vans/${vanId}/reminders`, body),
    onSuccess: () => {
      setEditing(false)
      invalidate()
    },
    onError: (err) => setError(errText(err, 'Could not save.')),
  })
  return (
    <DrawerSection title="Reminder timing">
      <p className="text-[13px] text-muted">
        {m.reminders.days_before} days before a date · {m.reminders.miles_before.toLocaleString()} miles before a mileage target ·{' '}
        {m.reminders.custom ? 'this van only' : 'company default'}
      </p>
      {editing ? (
        <form
          className="flex flex-col gap-2 rounded-row bg-surface-2 p-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            save.mutate({ remind_days_before: Number(days), remind_miles_before: Number(mi) })
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label="Days before">
              <Input type="number" min={0} max={365} required value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            <Field label="Miles before">
              <Input type="number" min={0} max={100000} required value={mi} onChange={(e) => setMi(e.target.value)} />
            </Field>
          </div>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending}>
              Save for this van
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Change for this van
          </Button>
          {m.reminders.custom && (
            <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ remind_days_before: null, remind_miles_before: null })}>
              Use company default
            </Button>
          )}
        </div>
      )}
    </DrawerSection>
  )
}

function HistorySection({ vanId }: { vanId: string }) {
  const [open, setOpen] = useState(false)
  const q = useQuery({ queryKey: ['fleet', 'history', vanId], queryFn: () => api.get<MaintenanceRecord[]>(`/fleet/vans/${vanId}/history`), enabled: open })
  return (
    <DrawerSection title="Maintenance history">
      {!open ? (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
          Show history
        </Button>
      ) : q.isLoading ? (
        <p className="text-[13px] text-muted">Loading…</p>
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-[13px] text-muted">Nothing marked done yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider rounded-row border border-line text-[13px]">
          {(q.data ?? []).map((r) => (
            <li key={r.id} className="flex flex-col gap-0.5 px-3 py-2">
              <span className="font-medium text-ink">
                {r.item_name} · {shortDate(r.done_date)}
                {r.odometer !== null ? ` · ${miles(r.odometer)}` : ''}
              </span>
              <span className="text-muted">
                {r.was_due_date ? `Was due ${shortDate(r.was_due_date)}` : r.was_due_miles !== null ? `Was due at ${miles(r.was_due_miles)}` : 'No due set'}
                {r.next_due_date ? ` · next ${shortDate(r.next_due_date)}` : r.next_due_miles !== null ? ` · next at ${miles(r.next_due_miles)}` : ''}
                {r.done_by ? ` · by ${r.done_by}` : ''}
              </span>
              {r.notes && <span className="text-muted">{r.notes}</span>}
            </li>
          ))}
        </ul>
      )}
    </DrawerSection>
  )
}

function FuelSection({ vanId }: { vanId: string }) {
  const invalidate = useInvalidate()
  const q = useQuery({ queryKey: ['fleet', 'fuel', vanId], queryFn: () => api.get<FuelEntry[]>(`/fleet/vans/${vanId}/fuel`) })
  const [adding, setAdding] = useState(false)
  const [fixing, setFixing] = useState<FuelEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (v: { id?: string; body: Record<string, unknown> }) =>
      v.id ? api.patch(`/fleet/fuel/${v.id}`, v.body) : api.post('/fleet/fuel', { van_id: vanId, ...v.body }),
    onSuccess: () => {
      setAdding(false)
      setFixing(null)
      invalidate()
    },
    onError: (err) => setError(errText(err, 'Could not save.')),
  })
  const entries = q.data ?? []
  return (
    <DrawerSection title="Fuel and odometer">
      {adding || fixing ? (
        <EntryForm
          entry={fixing}
          busy={save.isPending}
          error={error}
          onCancel={() => {
            setAdding(false)
            setFixing(null)
            setError(null)
          }}
          onSave={(body) => {
            setError(null)
            save.mutate({ id: fixing?.id, body })
          }}
        />
      ) : (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setAdding(true)}>
          <span className="material-symbols-outlined !text-[16px]">local_gas_station</span>
          Add entry
        </Button>
      )}
      {entries.length === 0 ? (
        <p className="text-[13px] text-muted">No entries yet. Drivers add them from their Fuel tab.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider rounded-row border border-line text-[13px]">
          {entries.slice(0, 50).map((e) => (
            <li key={e.id} className="flex items-center gap-2 px-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium text-ink tabular">
                  {miles(e.miles)} · {shortDate(e.entry_date)}
                </span>
                <span className="text-muted">
                  {[e.gallons !== null ? `${e.gallons} gal` : null, e.cost !== null ? `$${e.cost.toFixed(2)}` : null, e.entered_by, e.edited_at ? 'fixed by office' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setFixing(e)}>
                Fix
              </Button>
            </li>
          ))}
        </ul>
      )}
    </DrawerSection>
  )
}

function EntryForm({
  entry,
  busy,
  error,
  onCancel,
  onSave,
}: {
  entry: FuelEntry | null
  busy: boolean
  error: string | null
  onCancel: () => void
  onSave: (b: Record<string, unknown>) => void
}) {
  const [date, setDate] = useState(entry?.entry_date ?? '')
  const [mi, setMi] = useState(entry ? String(entry.miles) : '')
  const [gal, setGal] = useState(entry?.gallons === null || entry?.gallons === undefined ? '' : String(entry.gallons))
  const [cost, setCost] = useState(entry?.cost === null || entry?.cost === undefined ? '' : String(entry.cost))
  return (
    <form
      className="flex flex-col gap-2 rounded-row bg-surface-2 p-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        onSave({ miles: Number(mi), gallons: num(gal), cost: num(cost), ...(date ? { entry_date: date } : {}) })
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Odometer (miles)">
          <Input type="number" min={0} required value={mi} onChange={(e) => setMi(e.target.value)} />
        </Field>
        <Field label="Date (blank = today)">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Gallons (optional)">
          <Input type="number" min={0} step="0.01" value={gal} onChange={(e) => setGal(e.target.value)} />
        </Field>
        <Field label="Cost $ (optional)">
          <Input type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
      </div>
      <ErrorLine error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {entry ? 'Save fix' : 'Add'}
        </Button>
      </div>
    </form>
  )
}
