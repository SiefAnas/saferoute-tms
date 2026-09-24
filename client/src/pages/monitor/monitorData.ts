import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { MonitorHome } from '../../types/api'

// GET /monitor/me (monitor-role): everything the monitor's Today screen and header need.
export function useMonitorHome() {
  return useQuery({ queryKey: ['monitor-me'], queryFn: () => api.get<MonitorHome>('/monitor/me') })
}
