import { MoreScreen } from '@/features/admin/MoreScreen'
import { WEBSITE_PAGES } from '@/features/admin/logic'

// Company admin, More tab: everything the app doesn't do opens the website.
export default function CompanyMoreScreen() {
  return (
    <MoreScreen
      links={[
        { label: 'Assignments', path: WEBSITE_PAGES.assignments, icon: 'assignment' },
        { label: 'Fleet (vans)', path: WEBSITE_PAGES.fleet, icon: 'local-shipping' },
        { label: 'Payroll', path: WEBSITE_PAGES.payroll, icon: 'payments' },
        { label: 'Monitors and driver assignments', path: WEBSITE_PAGES.monitors, icon: 'badge' },
        { label: 'Parents and linking', path: WEBSITE_PAGES.parents, icon: 'family-restroom' },
        { label: 'Company profile', path: WEBSITE_PAGES.companyProfile, icon: 'apartment' },
      ]}
    />
  )
}
