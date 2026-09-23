import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'
import { Modal } from './Modal'
import { Button } from './Button'
import { Field, Input } from './Input'
import { PasswordField } from './PasswordField'
import type { PublicUser } from '../types/api'

// Shared edit form for an admin-created account (driver/parent/school_staff) — gives the
// creator-only edit permission (server/src/services/users.js's updateUser) a real UI.
// Password field is optional: leaving it blank keeps the current password unchanged.
export function EditAccountModal({
  user,
  invalidateKey,
  onClose,
}: {
  user: PublicUser
  invalidateKey: unknown[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState(user.full_name)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [address, setAddress] = useState(user.address ?? '')
  const [licenseNumber, setLicenseNumber] = useState(user.license_number ?? '')
  const [email, setEmail] = useState(user.email)
  const [isActive, setIsActive] = useState(user.is_active)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      api.patch<PublicUser>(`/users/${user.id}`, {
        full_name: fullName,
        phone: phone || null,
        ...(user.role === 'driver' || user.role === 'parent' ? { address: address || null } : {}),
        ...(user.role === 'driver' ? { license_number: licenseNumber || null } : {}),
        email,
        is_active: isActive,
        ...(password ? { password } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invalidateKey })
      onClose()
    },
    onError: (err) =>
      setError(
        err instanceof ApiError
          ? err.status === 403
            ? "Only the admin who created this account can edit it."
            : err.message
          : 'Could not save changes.',
      ),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    save.mutate()
  }

  return (
    <Modal title={`Edit ${user.full_name}`} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <Field label="Full name">
          <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email (used to log in)">
            <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input required type="tel" placeholder="555-123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        {(user.role === 'driver' || user.role === 'parent') && (
          <Field label="Home address">
            <Input required placeholder="Street, city, state, zip" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        )}
        {user.role === 'driver' && (
          <Field label="Driver license number">
            <Input required value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
          </Field>
        )}
        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          placeholder="Leave blank to keep the current one"
          hint="Leave blank to keep the current password. To set a new one: at least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special character."
        />
        <label className="flex cursor-pointer items-center gap-2 text-[14px] text-ink">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 accent-amber" />
          Account active{!isActive && '. This account will not be able to log in'}
        </label>

        {error && (
          <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
