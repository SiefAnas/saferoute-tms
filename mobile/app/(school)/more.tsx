import { useAuth } from '@/auth/auth'
import { MoreScreen } from '@/features/admin/MoreScreen'
import { WEBSITE_PAGES } from '@/features/admin/logic'

// School admin / staff, More tab: logging a schedule change, staff access and the school
// profile are on the website.
export default function SchoolMoreScreen() {
  const { user } = useAuth()
  if (user?.role === 'school_admin') {
    return (
      <MoreScreen
        links={[
          { label: 'Students and schedule changes', path: WEBSITE_PAGES.schoolStudents, icon: 'groups' },
          { label: 'Pickup and drop-off (full page)', path: WEBSITE_PAGES.schoolPickup, icon: 'how-to-reg' },
          { label: 'Staff and access', path: WEBSITE_PAGES.staffAccess, icon: 'badge' },
          { label: 'School profile', path: WEBSITE_PAGES.schoolProfile, icon: 'school' },
        ]}
      />
    )
  }
  return <MoreScreen links={[{ label: 'Pickup, drop-off and schedule changes', path: WEBSITE_PAGES.staffPickup, icon: 'how-to-reg' }]} />
}
