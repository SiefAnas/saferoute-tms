import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'
import { Modal } from './Modal'
import { Button } from './Button'
import { Input } from './Input'
import { PasswordStrengthMeter } from './PasswordStrengthMeter'
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
  const [showPassword, setShowPassword] = useState(false)
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
        <Input required placeholder="Full name (as it should appear in the app)" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <Input required type="email" placeholder="Email address (used to log in)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input required type="tel" placeholder="Phone number (e.g. 555-123-4567)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        {(user.role === 'driver' || user.role === 'parent') && (
          <Input required placeholder="Home address (street, city, state, zip)" value={address} onChange={(e) => setAddress(e.target.value)} />
        )}
        {user.role === 'driver' && (
          <Input
            required
            placeholder="Driver license number"
            value={licenseNumber}
            onChange={(e) => setLicenseNumber(e.target.value)}
          />
        )}
        <div className="flex flex-col gap-2">
          <div className="relative flex items-center">
            <Input
              type={showPassword ? 'text' : 'password'}
              minLength={8}
              placeholder="New password (leave blank to keep current)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-4 text-outline hover:text-secondary"
            >
              <span className="material-symbols-outlined">{showPassword ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
          <p className="text-label-md text-on-surface-variant">
            Leave blank to keep the current password. To set a new one: at least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special character.
          </p>
          <PasswordStrengthMeter password={password} />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-body-md text-on-surface">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-outline text-primary focus:ring-primary-container"
          />
          Account active{!isActive && '. This account will not be able to log in'}
        </label>

        {error && (
          <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
