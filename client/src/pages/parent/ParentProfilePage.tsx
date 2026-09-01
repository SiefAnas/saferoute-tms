import { useAuth } from '../../lib/auth'
import { Card } from '../../components/Card'
import { ContactLink } from '../../components/ContactLink'

// Read-only, username only — no password/email edit here. Self-service edit for
// driver/parent/school_staff is intentionally admin-only for now (§ permission-changes
// task) — only the admin who created this account can change its password/email.
// TODO (v2): self-service password/email change.
// TODO (v2): 2FA / signup verification.
export function ParentProfilePage() {
  const { user } = useAuth()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">Profile</h1>
      <Card className="flex flex-col gap-2 p-5">
        <p className="text-label-md text-on-surface-variant uppercase">Username</p>
        <p className="text-body-lg text-on-surface">
          <ContactLink type="email" value={user?.email} />
        </p>
        <p className="mt-3 text-body-sm text-on-surface-variant">
          Password and email can only be changed by the admin who created your account. Contact your transportation
          company if you need this updated.
        </p>
      </Card>
    </div>
  )
}
