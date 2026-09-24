import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { formatRate } from '../../lib/format'
import { formatWeekdays, MON_TO_FRI } from '../../lib/weekdays'
import { Button } from '../../components/Button'
import { Field, Input, Select } from '../../components/Input'
import { TemporaryPasswordDialog } from '../../components/TemporaryPasswordDialog'
import { StatusBadge } from '../../components/StatusBadge'
import { EditAccountModal } from '../../components/EditAccountModal'
import { ContactLink } from '../../components/ContactLink'
import { Modal } from '../../components/Modal'
import { Drawer, DetailRows } from '../../components/Drawer'
import { EmptyState } from '../../components/EmptyState'
import { WeekdayPicker } from '../../components/WeekdayPicker'
import { NameCell, NoMatches, PageIntro, SearchField, StatCard, StatRow, TableCard, TableRow, matches } from '../../components/Records'
import { PageTopBar } from '../../layouts/TopBar'
import { clockTime } from '../driver/driverData'
import type { CreatedUser, Monitor, MonitorAssignment, PayRule, PublicUser } from '../../types/api'

const TEMPLATE = '1.8fr 1.1fr 1.4fr 1.3fr 1fr 1fr'
const SHIFT_TEXT: Record<MonitorAssignment['shift_period'], string> = { morning: 'Mornings', afternoon: 'Afternoons', both: 'Morning + afternoon' }

// EditAccountModal takes a PublicUser; a monitor has no address or license.
const asPublicUser = (m: Monitor): PublicUser => ({ ...m, address: null, license_number: null, email_verified_at: null })

// Company Admin — Monitors (monitor-role). A monitor rides in a driver's van and checks in and out
// for their hours; they never see student data. Here the admin adds monitors (temporary password,
// like drivers), assigns each one to a driver with the weekdays and shift, edits them and resets
// their password (Edit). Pay rates are set on the Payroll page, where monitors show under their driver.
export function MonitorsPage() {
  const queryClient = useQueryClient()
  const monitorsQuery = useQuery({ queryKey: ['monitors'], queryFn: () => api.get<Monitor[]>('/monitors') })
  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
  const rulesQuery = useQuery({ queryKey: ['payroll-rules'], queryFn: () => api.get<PayRule[]>('/payroll/rules') })
  const monitors = monitorsQuery.data ?? []
  const rules = new Map((rulesQuery.data ?? []).map((r) => [r.driver_id, r]))

  const [q, setQ] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editUser, setEditUser] = useState<PublicUser | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [created, setCreated] = useState<CreatedUser | null>(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const addMonitor = useMutation({
    mutationFn: () => api.post<CreatedUser>('/users', { role: 'monitor', fullName: name, email, phone: phone || undefined }),
    onSuccess: (m) => {
      queryClient.invalidateQueries({ queryKey: ['monitors'] })
      setCreated(m)
      setName('')
      setEmail('')
      setPhone('')
      setShowAdd(false)
      setDetailId(m.id)
    },
    onError: (err) => setAddError(err instanceof ApiError ? err.message : 'Could not create the monitor account.'),
  })
  function handleAdd(e: FormEvent) {
    e.preventDefault()
    setAddError(null)
    addMonitor.mutate()
  }

  const active = monitors.filter((m) => m.is_active)
  const onShift = active.filter((m) => m.open_session)
  const unassigned = active.filter((m) => !m.assignment)
  const visible = monitors.filter((m) => matches(q, m.full_name, m.email, m.phone, m.assignment?.driver_name))
  const detail = monitors.find((m) => m.id === detailId) ?? null

  const status = (m: Monitor) =>
    !m.is_active ? (
      <StatusBadge tone="alert" label="Deactivated" />
    ) : m.open_session ? (
      <StatusBadge tone="success" label={`Checked in · ${clockTime(m.open_session.check_in_at)}`} />
    ) : (
      <StatusBadge tone="neutral" label="Not checked in" />
    )

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="Monitors">
        <SearchField value={q} onChange={setQ} placeholder="Search monitors" />
        <Button onClick={() => setShowAdd(true)}>
          <span className="material-symbols-outlined !text-[18px]">person_add</span>
          Add monitor
        </Button>
      </PageTopBar>

      <PageIntro>Monitors ride with a driver and check in for their hours. They see their driver and van, never student details.</PageIntro>

      <StatRow>
        <StatCard label="On shift now" value={onShift.length} tone={onShift.length ? 'success' : 'default'} sub={`of ${active.length} active monitors`} />
        <StatCard label="No driver yet" value={unassigned.length} tone={unassigned.length ? 'caution' : 'default'} sub={unassigned.length ? unassigned.map((m) => m.full_name).join(', ') : 'Everyone has a driver'} />
        <StatCard label="Deactivated" value={monitors.length - active.length} sub={monitors.length - active.length ? 'Open a monitor to turn them back on' : 'None'} />
      </StatRow>

      <TableCard
        template={TEMPLATE}
        columns={[{ label: 'Monitor' }, { label: 'Phone' }, { label: 'Driver' }, { label: 'Days · shift' }, { label: 'Pay rate' }, { label: 'Status' }]}
      >
        {monitorsQuery.isLoading ? (
          <p className="border-t border-divider px-5 py-4 text-[14px] text-muted">Loading…</p>
        ) : monitors.length === 0 ? (
          <EmptyState
            icon="badge"
            title="No monitors yet"
            body="Add a monitor, then assign them to the driver they ride with."
            action={<Button onClick={() => setShowAdd(true)}>Add monitor</Button>}
          />
        ) : visible.length === 0 ? (
          <NoMatches q={q} hint="Search looks at names, emails, phone numbers and drivers." onClear={() => setQ('')} />
        ) : (
          visible.map((m) => {
            const rule = rules.get(m.id)
            return (
              <TableRow key={m.id} template={TEMPLATE} selected={detailId === m.id} onClick={() => setDetailId(m.id)}>
                <NameCell name={m.full_name} sub={m.email} />
                <span className="truncate text-ink-sub tabular">{m.phone ?? '—'}</span>
                <span className="truncate text-ink-sub">{m.assignment?.driver_name ?? 'Not assigned'}</span>
                <span className="truncate text-ink-sub">
                  {m.assignment ? `${formatWeekdays(m.assignment.days_of_week)} · ${SHIFT_TEXT[m.assignment.shift_period]}` : '—'}
                </span>
                <span className="truncate text-ink-sub tabular">{rule ? formatRate(rule.rate_cents, rule.rate_type) : 'Not set'}</span>
                <span>{status(m)}</span>
              </TableRow>
            )
          })
        )}
      </TableCard>

      {detail && (
        <Drawer
          eyebrow="MONITOR"
          title={detail.full_name}
          subtitle={detail.email}
          onClose={() => setDetailId(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditUser(asPublicUser(detail))}>
                <span className="material-symbols-outlined !text-[18px]">edit</span>
                Edit or reset password
              </Button>
              <Button onClick={() => setDetailId(null)}>Done</Button>
            </div>
          }
        >
          <DetailRows
            rows={[
              { k: 'Status', v: status(detail) },
              { k: 'Phone', v: <ContactLink type="phone" value={detail.phone} /> },
              { k: 'Email', v: <ContactLink type="email" value={detail.email} /> },
              { k: 'Pay rate', v: rules.get(detail.id) ? formatRate(rules.get(detail.id)!.rate_cents, rules.get(detail.id)!.rate_type) : 'Not set (Payroll page)' },
            ]}
          />
          <AssignmentForm key={detail.id} monitor={detail} drivers={(driversQuery.data ?? []).filter((d) => d.is_active)} />
        </Drawer>
      )}

      {showAdd && (
        <Modal title="Add monitor" onClose={() => setShowAdd(false)}>
          <form className="flex flex-col gap-3" onSubmit={handleAdd}>
            <Field label="Full name">
              <Input required placeholder="Sam Rivera" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Email (used to log in)">
                <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Phone (optional)">
                <Input type="tel" placeholder="555-123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </div>
            <p className="text-[13px] text-muted">
              SafeRoute makes a temporary password for you to give the monitor. They choose their own the first time they sign in.
            </p>
            {addError && (
              <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
                {addError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addMonitor.isPending}>
                {addMonitor.isPending ? 'Creating…' : 'Add monitor'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {editUser && <EditAccountModal user={editUser} invalidateKey={['monitors']} onClose={() => setEditUser(null)} />}
      {created && (
        <TemporaryPasswordDialog name={created.full_name} email={created.email} password={created.temporary_password} onClose={() => setCreated(null)} />
      )}
    </div>
  )
}

// The drawer's "Rides with" section: pick the driver, the weekdays and the shift. Saving again
// replaces the assignment (one driver per monitor).
function AssignmentForm({ monitor, drivers }: { monitor: Monitor; drivers: PublicUser[] }) {
  const queryClient = useQueryClient()
  const a = monitor.assignment
  const [driverId, setDriverId] = useState(a?.driver_user_id ?? '')
  const [days, setDays] = useState<number[]>(a?.days_of_week ?? MON_TO_FRI)
  const [shift, setShift] = useState<MonitorAssignment['shift_period']>(a?.shift_period ?? 'both')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 3000)
    return () => clearTimeout(t)
  }, [saved])

  const done = () => {
    setError(null)
    setSaved(true)
    queryClient.invalidateQueries({ queryKey: ['monitors'] })
  }
  const fail = (err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not save.')
  const save = useMutation({
    mutationFn: () => api.put<Monitor>(`/monitors/${monitor.id}/assignment`, { driver_user_id: driverId, days_of_week: days, shift_period: shift }),
    onSuccess: done,
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/monitors/${monitor.id}/assignment`),
    onSuccess: () => {
      setDriverId('')
      done()
    },
    onError: fail,
  })

  return (
    <form
      className="mt-5 flex flex-col gap-3 border-t border-divider pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <h3 className="text-[14px] font-semibold text-ink">Rides with</h3>
      <Field label="Driver">
        <Select required value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Choose a driver</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.full_name}
            </option>
          ))}
        </Select>
      </Field>
      <WeekdayPicker value={days} onChange={setDays} />
      <Field label="Shift">
        <Select value={shift} onChange={(e) => setShift(e.target.value as MonitorAssignment['shift_period'])}>
          <option value="both">Morning + afternoon</option>
          <option value="morning">Mornings only</option>
          <option value="afternoon">Afternoons only</option>
        </Select>
      </Field>
      {error && (
        <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        {saved && <span className="text-[13px] text-muted">Saved</span>}
        {a && (
          <Button type="button" variant="outline" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Remove from driver
          </Button>
        )}
        <Button type="submit" size="sm" disabled={save.isPending || !driverId}>
          {save.isPending ? 'Saving…' : a ? 'Save changes' : 'Assign'}
        </Button>
      </div>
    </form>
  )
}
