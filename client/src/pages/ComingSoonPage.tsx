import { useAuth } from '../lib/auth'

// Placeholder for School Admin / School Staff — new layouts, same design tokens,
// intentionally not built yet (per the agreed build order: driver + company admin first).
// This exists so login/routing doesn't dead-end for these two roles.
export function ComingSoonPage({ title }: { title: string }) {
  const { user, logout } = useAuth()
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary-container">
        <span className="material-symbols-outlined !text-[32px] text-on-primary-container">construction</span>
      </div>
      <h1 className="text-headline-md text-primary">{title}</h1>
      <p className="max-w-sm text-body-md text-on-surface-variant">
        Signed in as {user?.full_name}. This screen hasn't been built yet — it's next up after the
        driver and company admin dashboards.
      </p>
      <button type="button" onClick={logout} className="text-label-md text-primary hover:underline">
        Log out
      </button>
    </main>
  )
}
