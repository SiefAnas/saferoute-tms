import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'
import { Modal } from './Modal'
import { Button } from './Button'
import { Field, Input } from './Input'
import { TemporaryPasswordDialog } from './TemporaryPasswordDialog'
import type { PasswordResetResult, PublicUser } from '../types/api'

// Shared edit form for an admin-created account (driver/parent/school_staff) — gives the
// creator-only edit permission (server/src/services/users.js's updateUser) a real UI.
// Passwords: the admin can't type one any more. "Reset password" gives the user a new
// temporary password (shown once) that they must replace at next sign-in.
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
  const [error, setError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetResult, setResetResult] = useState<PasswordResetResult | null>(null)

  const reset = useMutation({
    mutationFn: () => api.post<PasswordResetResult>(`/users/${user.id}/reset-password`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: invalidateKey })
      setResetResult(res)
    },
    onError: (err) =>
      setError(
        err instanceof ApiError
          ? err.status === 403
            ? 'Only the admin who created this account can reset its password.'
            : err.message
          : 'Could not reset the password.',
      ),
  })

  const save = useMutation({
    mutationFn: () =>
      api.patch<PublicUser>(`/users/${user.id}`, {
        full_name: fullName,
        phone: phone || null,
        ...(user.role === 'driver' || user.role === 'parent' ? { address: address || null } : {}),
        ...(user.role === 'driver' ? { license_number: licenseNumber || null } : {}),
        email,
        is_active: isActive,
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

  if (resetResult) {
    return <TemporaryPasswordDialog reset name={user.full_name} email={resetResult.user.email} password={resetResult.temporary_password} onClose={onClose} />
  }

  // Parents keep phone + address required (they're used to match parents to students).
  const contactRequired = user.role === 'parent'

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
            <Input required={contactRequired} type="tel" placeholder="555-123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        {(user.role === 'driver' || user.role === 'parent') && (
          <Field label="Home address">
            <Input required={contactRequired} placeholder="Street, city, state, zip" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        )}
        {user.role === 'driver' && (
          <Field label="Driver license number">
            <Input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
          </Field>
        )}
        <div className="flex flex-col gap-2 rounded-btn border border-line px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex flex-col">
              <span className="text-[13px] font-semibold text-ink">Password</span>
              <span className="text-[12px] text-muted">
                {user.must_change_password ? "Hasn't set their own password yet." : 'Set by them. You never see it.'}
              </span>
            </span>
            {!confirmReset && (
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmReset(true)}>
                Reset password
              </Button>
            )}
          </div>
          {confirmReset && (
            <div className="flex flex-col gap-2 rounded-row bg-surface-2 px-3 py-2.5 text-[13px] text-ink">
              {user.full_name} gets a new temporary password to use once. Their current password stops working and they are signed
              out everywhere.
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirmReset(false)}>
                  Keep password
                </Button>
                <Button type="button" variant="danger" size="sm" disabled={reset.isPending} onClick={() => reset.mutate()}>
                  {reset.isPending ? 'Resetting…' : 'Reset password'}
                </Button>
              </div>
            </div>
          )}
        </div>
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
