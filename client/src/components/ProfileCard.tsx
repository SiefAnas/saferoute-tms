import type { FormEvent, ReactNode } from 'react'
import { Card } from './Card'
import { Button } from './Button'

// Profile pages (design 5a): one 640px card holding a two-column form (fields that should span
// both columns pass className="sm:col-span-2" to their Field), with Cancel + amber Save changes.
export function ProfileCard({
  onSubmit,
  onCancel,
  saving,
  dirty,
  error,
  children,
}: {
  onSubmit: () => void
  onCancel: () => void
  saving: boolean
  dirty: boolean
  error: string | null
  children: ReactNode
}) {
  function handle(e: FormEvent) {
    e.preventDefault()
    onSubmit()
  }
  return (
    <Card className="max-w-[640px]">
      <form onSubmit={handle}>
        <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">{children}</div>
        {error && (
          <p role="alert" className="mx-6 mb-4 rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-divider px-6 py-4">
          <Button type="button" variant="outline" disabled={!dirty || saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
