import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'
import { Modal } from './Modal'
import { Button } from './Button'
import { Input } from './Input'
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
  const [email, setEmail] = useState(user.email)
  const [isActive, setIsActive] = useState(user.is_active)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      api.patch<PublicUser>(`/users/${user.id}`, {
        full_name: fullName,
        phone: phone || null,
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
        <Input required placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <Input required type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input
          type="password"
          minLength={8}
          placeholder="New password (leave blank to keep current)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label className="flex cursor-pointer items-center gap-2 text-body-md text-on-surface">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-outline text-primary focus:ring-primary-container"
          />
          Account active{!isActive && ' — this account will not be able to log in'}
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
