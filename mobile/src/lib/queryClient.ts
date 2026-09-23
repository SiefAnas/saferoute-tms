import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api'

// Retry only what is worth retrying. A 4xx is an answer (403 forbidden, 404 not found, 409
// business rule) and retrying it just delays showing the driver the message; a network failure
// or a 5xx is worth another go, because the API can be waking up from idle on Render.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status < 500) return false
          return failureCount < 2
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        // Shift data changes while the driver works, but they also pull to refresh, so this
        // keeps tab switches instant without showing very old numbers.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
}
