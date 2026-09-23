import { Redirect } from 'expo-router'
import { useAuth } from '@/auth/auth'
import { destinationForRole } from '@/lib/roles'

// The entry route only decides where to go. The native splash is still up while
// status is 'loading' (see app/_layout.tsx), so there is nothing to draw here.
export default function Index() {
  const { status, user } = useAuth()
  if (status === 'loading') return null
  if (status === 'signedOut') return <Redirect href="/login" />
  return <Redirect href={destinationForRole(user?.role)} />
}
