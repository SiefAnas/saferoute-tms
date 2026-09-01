import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { isToday, formatDuration } from '../../lib/format'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { StatusBadge } from '../../components/StatusBadge'
import { EditAccountModal } from '../../components/EditAccountModal'
import { CsvImportExport } from '../../components/CsvImportExport'
import { ContactLink } from '../../components/ContactLink'
import { Modal } from '../../components/Modal'
import { PasswordStrengthMeter } from '../../components/PasswordStrengthMeter'
import type { CsvColumn } from '../../lib/csv'
import type { DriverSession, PublicUser } from '../../types/api'

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

// Driver management — split out from the Company Admin Dashboard so drivers get their own
// page (nav restructuring per Anas's request). Carries over the "Live Driver Status" table
// and "Add Driver" form that used to live on the dashboard, plus new edit capability (the
// creator-only edit permission now has a real UI here).
export function DriversPage() {
  const queryClient = useQueryClient()
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
  const sessionsQuery = useQuery({ queryKey: ['sessions', 'all'], queryFn: () => api.get<DriverSession[]>('/sessions') })

  const [driverName, setDriverName] = useState('')
  const [driverEmail, setDriverEmail] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [driverAddress, setDriverAddress] = useState('')
  const [driverLicense, setDriverLicense] = useState('')
  const [driverPassword, setDriverPassword] = useState('')
  const [showDriverPassword, setShowDriverPassword] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addMsg, setAddMsg] = useState<string | null>(null)
  const [editUser, setEditUser] = useState<PublicUser | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)

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
      setAddMsg(`${driver.full_name} can now sign in with the password you set.`)
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
    setAddMsg(null)
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

  const driverRows = useMemo(() => {
    const sessions = sessionsQuery.data ?? []
    return (driversQuery.data ?? []).map((driver) => {
      const mine = sessions.filter((s) => s.user_id === driver.id)
      const open = mine.find((s) => s.check_out_at === null)
      const completedToday = mine
        .filter((s) => s.check_out_at && isToday(s.check_in_at))
        .reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0)
      const liveElapsed = open && isToday(open.check_in_at) ? (Date.now() - new Date(open.check_in_at).getTime()) / 60_000 : 0
      return { driver, open, minutesToday: completedToday + Math.max(0, liveElapsed) }
    })
  }, [driversQuery.data, sessionsQuery.data])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-headline-lg text-primary">Drivers</h1>
        <div className="flex items-center gap-3">
          <CsvImportExport
            entityName="Drivers"
            columns={CSV_COLUMNS}
            rows={driversQuery.data ?? []}
            onImportRow={handleImportRow}
            onImportComplete={() => queryClient.invalidateQueries({ queryKey: ['users', 'driver'] })}
          />
          <Button type="button" onClick={() => setShowAddModal(true)} className="flex items-center gap-1">
            <span className="material-symbols-outlined !text-[18px]">person_add</span>
            Add a Driver
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 flex flex-col overflow-hidden">
          <CardHeader>
            <h2 className="text-title-lg text-primary">Live Driver Status</h2>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr>
                  {['Driver Name', 'Status', 'Hours Today', 'Active', ''].map((h) => (
                    <th key={h} className="px-6 py-2 text-label-md text-secondary uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {driverRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-4 text-body-md text-on-surface-variant">
                      {driversQuery.isLoading ? 'Loading…' : 'No drivers yet.'}
                    </td>
                  </tr>
                ) : (
                  driverRows.map(({ driver, open, minutesToday }) => (
                    <tr key={driver.id} className="hover:bg-surface-container-low">
                      <td className="px-6 py-3 text-body-md font-medium">
                        {driver.full_name}
                        <div className="text-label-md text-on-surface-variant">
                          <ContactLink type="phone" value={driver.phone} />
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        {open ? (
                          <StatusBadge tone="success" label="Checked In" pulse />
                        ) : (
                          <StatusBadge tone="neutral" label="Checked Out" />
                        )}
                      </td>
                      <td className="px-6 py-3 text-data-mono text-secondary">{formatDuration(minutesToday)}</td>
                      <td className="px-6 py-3">
                        {driver.is_active ? (
                          <StatusBadge tone="success" label="Active" />
                        ) : (
                          <StatusBadge tone="error" label="Deactivated" />
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <button
                          type="button"
                          onClick={() => setEditUser(driver)}
                          className="text-label-md text-primary hover:underline"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

      </div>

      {showAddModal && (
        <Modal title="Add a Driver" onClose={() => setShowAddModal(false)}>
          <form className="flex flex-col gap-3" onSubmit={handleAdd}>
            <Input required placeholder="Full name (e.g. Jordan Ellis)" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
            <Input
              required
              type="email"
              placeholder="Email address (used to log in)"
              value={driverEmail}
              onChange={(e) => setDriverEmail(e.target.value)}
            />
            <Input
              required
              type="tel"
              placeholder="Phone number (e.g. 555-123-4567)"
              value={driverPhone}
              onChange={(e) => setDriverPhone(e.target.value)}
            />
            <Input
              required
              placeholder="Home address (street, city, state, zip)"
              value={driverAddress}
              onChange={(e) => setDriverAddress(e.target.value)}
            />
            <Input
              required
              placeholder="Driver license number"
              value={driverLicense}
              onChange={(e) => setDriverLicense(e.target.value)}
            />
            <div className="flex flex-col gap-2">
              <div className="relative flex items-center">
                <Input
                  required
                  type={showDriverPassword ? 'text' : 'password'}
                  minLength={8}
                  placeholder="Password"
                  value={driverPassword}
                  onChange={(e) => setDriverPassword(e.target.value)}
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowDriverPassword((v) => !v)}
                  aria-label={showDriverPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-4 text-outline hover:text-secondary"
                >
                  <span className="material-symbols-outlined">{showDriverPassword ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
              <p className="text-label-md text-on-surface-variant">
                At least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special character.
              </p>
              <PasswordStrengthMeter password={driverPassword} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="secondary" disabled={addDriver.isPending} className="flex-1">
                {addDriver.isPending ? 'Creating…' : 'Add Driver'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
            </div>
            {addMsg && <p className="text-body-md text-on-surface-variant">{addMsg}</p>}
            {addError && (
              <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">
                {addError}
              </p>
            )}
          </form>
        </Modal>
      )}

      {editUser && (
        <EditAccountModal user={editUser} invalidateKey={['users', 'driver']} onClose={() => setEditUser(null)} />
      )}
    </div>
  )
}
