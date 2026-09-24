import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { api } from '@/api'
import type { MonitorHome } from '@/api/types'

export { defaultMonitorShift, isoWeekday, ridesToday, SHIFT_TEXT } from './helpers'

// Monitor app data (monitor-role). One call, GET /monitor/me, gives the whole Today screen.
export function useMonitorHome(): UseQueryResult<MonitorHome> {
  return useQuery({ queryKey: ['monitor-me'], queryFn: () => api.get<MonitorHome>('/monitor/me') })
}
