import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { isToday, formatDuration, formatRate } from '../../lib/format'
import { currentAssignmentBy, vanLabel } from '../../lib/fleet'
import { Button } from '../../components/Button'
import { Field, Input } from '../../components/Input'
import { PasswordField } from '../../components/PasswordField'
import { StatusBadge } from '../../components/StatusBadge'
import { EditAccountModal } from '../../components/EditAccountModal'
import { CsvImportExport } from '../../components/CsvImportExport'
import { ContactLink } from '../../components/ContactLink'
import { Modal } from '../../components/Modal'
import { Drawer, DetailRows } from '../../components/Drawer'
import { EmptyState } from '../../components/EmptyState'
import { NameCell, NoMatches, PageIntro, SearchField, StatCard, StatRow, TableCard, TableRow, matches } from '../../components/Records'
import { useToast } from '../../components/Toast'
import { PageTopBar } from '../../layouts/TopBar'
import type { CsvColumn } from '../../lib/csv'
import type { Assignment, DriverSession, PayRule, PublicUser, Van } from '../../types/api'

const CSV_COLUMNS: CsvColumn<PublicUser>[] = [
  { key: 'full_name', header: 'Full Name' },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  { key: 'address', header: 'Address' },
  { key: 'license_number', header: 'License Number' },
  // Never exported — we don't store/return plaintext passwords. Present in the template
  // so a row for a NEW driver has somewhere to put one; left blank on an existing driver's
  // row leaves their password unchanged on re-import.
  { key: 'password', header: 'Password', value: () => '' },
  { key: 'is_active', header: 'Active', value: (d) => (d.is_active ? 'true' : 'false') },
]

const TEMPLATE = '2fr 1.2fr 1fr 1.1fr 1fr'

// Company Admin — Drivers (design 5a records template): who drives for the company, their van
// today, pay rate and live shift status. Add/edit keep the existing forms (creator-only edit is
// enforced server-side, see EditAccountModal).
export function DriversPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
  const sessionsQuery = useQuery({ queryKey: ['sessions', 'all'], queryFn: () => api.get<DriverSession[]>('/sessions') })
  const assignmentsQuery = useQuery({ queryKey: ['assignments'], queryFn: () => api.get<Assignment[]>('/assignments') })
  const vansQuery = useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })
  const rulesQuery = useQuery({ queryKey: ['payroll-rules'], queryFn: () => api.get<PayRule[]>('/payroll/rules') })

  const [q, setQ] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editUser, setEditUser] = useState<PublicUser | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)

  // ---- Add driver ----
  const [driverName, setDriverName] = useState('')
  const [driverEmail, setDriverEmail] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [driverAddress, setDriverAddress] = useState('')
  const [driverLicense, setDriverLicense] = useState('')
  const [driverPassword, setDriverPassword] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const addDriver = useMutation({
    mutationFn: () =>
      // The password set here is real and permanent — the driver signs in with it directly,
      // no forced first-login change (none exists anywhere in this app).
      api.post<PublicUser>('/users', {
        role: 'driver',
        fullName: driverName,
        email: driverEmail,
        phone: driverPhone || undefined,
        address: driverAddress || undefined,
        licenseNumber: driverLicense || undefined,
        password: driverPassword,
      }),
    onSuccess: (driver) => {
      queryClient.invalidateQueries({ queryKey: ['users', 'driver'] })
      toast.show(`${driver.full_name} can now sign in with the password you set`)
      setDriverName('')
      setDriverEmail('')
      setDriverPhone('')
      setDriverAddress('')
      setDriverLicense('')
      setDriverPassword('')
      setShowAddModal(false)
    },
    onError: (err) => setAddError(err instanceof ApiError ? err.message : 'Could not create driver account.'),
  })

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    setAddError(null)
    addDriver.mutate()
  }

  // CSV import (2026-08-28): upsert by email, per the task's own matching rule for "people".
  // Existing driver -> PATCH /users/:id (naturally enforces creator-only edit — a row for a
  // driver this admin didn't create fails with that same 403 message, not a silent bypass).
  // No match -> POST /users, requires Full Name + Password (a brand-new account needs a
  // real password to log in with, same as the one-by-one Add Driver form).
  async function handleImportRow(row: Record<string, string>) {
    const email = row['Email']?.trim()
    if (!email) return { ok: false, message: 'Email is required' }
    const fullName = row['Full Name']?.trim()
    const phone = row['Phone']?.trim()
    const address = row['Address']?.trim()
    const license = row['License Number']?.trim()
    const password = row['Password']?.trim()
    const activeRaw = row['Active']?.trim().toLowerCase()

    const existing = (driversQuery.data ?? []).find((d) => d.email.toLowerCase() === email.toLowerCase())
    try {
      if (existing) {
        const patch: Record<string, unknown> = {}
        if (fullName) patch.full_name = fullName
        if (phone) patch.phone = phone
        if (address) patch.address = address
        if (license) patch.license_number = license
        if (password) patch.password = password
        if (activeRaw) patch.is_active = ['true', '1', 'yes'].includes(activeRaw)
        if (Object.keys(patch).length === 0) return { ok: true, message: 'No changes' }
        await api.patch(`/users/${existing.id}`, patch)
        return { ok: true, message: 'Updated' }
      }
      if (!fullName) return { ok: false, message: 'Full Name is required for a new driver' }
      if (!password) return { ok: false, message: 'Password is required for a new driver' }
      await api.post('/users', {
        role: 'driver', fullName, email, phone: phone || undefined, address: address || undefined, licenseNumber: license || undefined, password,
      })
      return { ok: true, message: 'Created' }
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Import failed' }
    }
  }

  const rows = useMemo(() => {
    const sessions = sessionsQuery.data ?? []
    const vans = new Map((vansQuery.data ?? []).map((v) => [v.id, v]))
    const current = currentAssignmentBy(assignmentsQuery.data ?? [], 'driver_user_id')
    const rules = new Map((rulesQuery.data ?? []).map((r) => [r.driver_id, r]))
    return (driversQuery.data ?? []).map((driver) => {
      const mine = sessions.filter((s) => s.user_id === driver.id)
      const open = mine.find((s) => s.check_out_at === null)
      const completedToday = mine.filter((s) => s.check_out_at && isToday(s.check_in_at)).reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0)
      const liveElapsed = open && isToday(open.check_in_at) ? (Date.now() - new Date(open.check_in_at).getTime()) / 60_000 : 0
      const a = current.get(driver.id)
      return {
        driver,
        open,
        minutesToday: completedToday + Math.max(0, liveElapsed),
        van: a ? (vans.get(a.van_id) ?? null) : null,
        rule: rules.get(driver.id) ?? null,
      }
    })
  }, [driversQuery.data, sessionsQuery.data, vansQuery.data, assignmentsQuery.data, rulesQuery.data])

  const active = rows.filter((r) => r.driver.is_active)
  const onShift = active.filter((r) => r.open)
  const notIn = active.filter((r) => !r.open)
  const deactivated = rows.filter((r) => !r.driver.is_active)
  const names = (list: typeof rows) => list.map((r) => r.driver.full_name).join(', ')

  const visible = rows.filter((r) => matches(q, r.driver.full_name, r.driver.email, r.driver.phone, r.van?.license_plate))
  const detail = rows.find((r) => r.driver.id === detailId) ?? null

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="Drivers">
        <SearchField value={q} onChange={setQ} placeholder="Search drivers" />
        <CsvImportExport
          entityName="Drivers"
          columns={CSV_COLUMNS}
          rows={driversQuery.data ?? []}
          onImportRow={handleImportRow}
          onImportComplete={() => queryClient.invalidateQueries({ queryKey: ['users', 'driver'] })}
        />
        <Button onClick={() => setShowAddModal(true)}>
          <span className="material-symbols-outlined !text-[18px]">person_add</span>
          Add driver
        </Button>
      </PageTopBar>

      <PageIntro>Driver accounts, their vans and live shift status.</PageIntro>

      <StatRow>
        <StatCard label="On shift now" value={onShift.length} tone={onShift.length ? 'success' : 'default'} sub={`of ${active.length} active drivers`} />
        <StatCard label="Not checked in" value={notIn.length} tone={notIn.length ? 'caution' : 'default'} sub={notIn.length ? names(notIn) : 'Everyone is on shift'} />
        <StatCard label="Deactivated" value={deactivated.length} sub={deactivated.length ? names(deactivated) : 'None'} />
      </StatRow>

      <TableCard
        template={TEMPLATE}
        columns={[{ label: 'Driver' }, { label: 'Phone' }, { label: 'Van' }, { label: 'Pay rate' }, { label: 'Status' }]}
      >
        {driversQuery.isLoading ? (
          <p className="border-t border-divider px-5 py-4 text-[14px] text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="person_add"
            title="No drivers yet"
            body="Add a driver so you can assign students and track their shifts."
            action={<Button onClick={() => setShowAddModal(true)}>Add driver</Button>}
          />
        ) : visible.length === 0 ? (
          <NoMatches q={q} hint="Search looks at names, emails, phone numbers and plates." onClear={() => setQ('')} />
        ) : (
          visible.map((r) => (
            <TableRow key={r.driver.id} template={TEMPLATE} selected={detailId === r.driver.id} onClick={() => setDetailId(r.driver.id)}>
              <NameCell name={r.driver.full_name} sub={r.driver.email} />
              <span className="truncate text-ink-sub tabular">{r.driver.phone ?? '—'}</span>
              <span className="truncate text-ink-sub">{r.van ? r.van.license_plate : '—'}</span>
              <span className="truncate text-ink-sub tabular">{r.rule ? formatRate(r.rule.rate_cents, r.rule.rate_type) : 'Not set'}</span>
              <span>
                {!r.driver.is_active ? (
                  <StatusBadge tone="alert" label="Deactivated" />
                ) : r.open ? (
                  <StatusBadge tone="success" label="Checked in" />
                ) : (
                  <StatusBadge tone="neutral" label="Not checked in" />
                )}
              </span>
            </TableRow>
          ))
        )}
      </TableCard>

      {detail && (
        <Drawer
          eyebrow="DETAILS"
          title={detail.driver.full_name}
          subtitle={detail.driver.email}
          onClose={() => setDetailId(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditUser(detail.driver)}>
                <span className="material-symbols-outlined !text-[18px]">edit</span>
                Edit
              </Button>
              <Button onClick={() => setDetailId(null)}>Done</Button>
            </div>
          }
        >
          <DetailRows
            rows={[
              {
                k: 'Status',
                v: !detail.driver.is_active ? (
                  <StatusBadge tone="alert" label="Deactivated" />
                ) : detail.open ? (
                  <StatusBadge tone="success" label="Checked in" />
                ) : (
                  <StatusBadge tone="neutral" label="Not checked in" />
                ),
              },
              { k: 'Phone', v: <ContactLink type="phone" value={detail.driver.phone} /> },
              { k: 'Email', v: <ContactLink type="email" value={detail.driver.email} /> },
              { k: 'Home address', v: detail.driver.address ?? '—' },
              { k: 'License', v: detail.driver.license_number ?? '—' },
              { k: 'Van today', v: detail.van ? vanLabel(detail.van) : 'No active assignment' },
              { k: 'Pay rate', v: detail.rule ? formatRate(detail.rule.rate_cents, detail.rule.rate_type) : 'Not set' },
              { k: 'Hours today', v: formatDuration(detail.minutesToday) },
            ]}
          />
        </Drawer>
      )}

      {showAddModal && (
        <Modal title="Add driver" onClose={() => setShowAddModal(false)}>
          <form className="flex flex-col gap-3" onSubmit={handleAdd}>
            <Field label="Full name">
              <Input required placeholder="Jordan Ellis" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Email (used to log in)">
                <Input required type="email" value={driverEmail} onChange={(e) => setDriverEmail(e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input required type="tel" placeholder="555-123-4567" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
              </Field>
            </div>
            <Field label="Home address">
              <Input required placeholder="Street, city, state, zip" value={driverAddress} onChange={(e) => setDriverAddress(e.target.value)} />
            </Field>
            <Field label="Driver license number">
              <Input required value={driverLicense} onChange={(e) => setDriverLicense(e.target.value)} />
            </Field>
            <PasswordField label="Password" required value={driverPassword} onChange={setDriverPassword} />
            {addError && (
              <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
                {addError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addDriver.isPending}>
                {addDriver.isPending ? 'Creating…' : 'Add driver'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {editUser && <EditAccountModal user={editUser} invalidateKey={['users', 'driver']} onClose={() => setEditUser(null)} />}
      {toast.node}
    </div>
  )
}
