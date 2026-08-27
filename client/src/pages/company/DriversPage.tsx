import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { isToday, formatDuration } from '../../lib/format'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { StatusBadge } from '../../components/StatusBadge'
import { EditAccountModal } from '../../components/EditAccountModal'
import type { DriverSession, PublicUser } from '../../types/api'

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
  const [addError, setAddError] = useState<string | null>(null)
  const [addMsg, setAddMsg] = useState<string | null>(null)
  const [editUser, setEditUser] = useState<PublicUser | null>(null)

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
    },
    onError: (err) => setAddError(err instanceof ApiError ? err.message : 'Could not create driver account.'),
  })

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    setAddError(null)
    setAddMsg(null)
    addDriver.mutate()
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
      <h1 className="text-headline-lg text-primary">Drivers</h1>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-8">
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
                        <div className="text-label-md text-on-surface-variant">{driver.email}</div>
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

        <Card className="col-span-12 p-5 lg:col-span-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-title-lg text-primary">Add Driver</h2>
            <span className="material-symbols-outlined text-secondary">person_add</span>
          </div>
          <form className="flex flex-col gap-3" onSubmit={handleAdd}>
            <Input required placeholder="Full name" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
            <Input
              required
              type="email"
              placeholder="Email address"
              value={driverEmail}
              onChange={(e) => setDriverEmail(e.target.value)}
            />
            <Input placeholder="Phone (optional)" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
            <Input placeholder="Address (optional)" value={driverAddress} onChange={(e) => setDriverAddress(e.target.value)} />
            <Input
              placeholder="Driver license number (optional)"
              value={driverLicense}
              onChange={(e) => setDriverLicense(e.target.value)}
            />
            <Input
              required
              type="password"
              minLength={8}
              placeholder="Password"
              value={driverPassword}
              onChange={(e) => setDriverPassword(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={addDriver.isPending}>
              {addDriver.isPending ? 'Creating…' : 'Add Driver'}
            </Button>
            {addMsg && <p className="text-body-md text-on-surface-variant">{addMsg}</p>}
            {addError && (
              <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">
                {addError}
              </p>
            )}
          </form>
        </Card>
      </div>

      {editUser && (
        <EditAccountModal user={editUser} invalidateKey={['users', 'driver']} onClose={() => setEditUser(null)} />
      )}
    </div>
  )
}
