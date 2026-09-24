import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'
import type { AbsentTodayEntry, Assignment, DriverSession, Monitor, PublicUser, SchoolSummary, Student, Van } from '@/api/types'

// Company admin data. The query keys match the web app's, one request per list.
export const useDrivers = () => useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
export const useParents = () => useQuery({ queryKey: ['users', 'parent'], queryFn: () => api.get<PublicUser[]>('/users?role=parent') })
export const useMonitors = () => useQuery({ queryKey: ['monitors'], queryFn: () => api.get<Monitor[]>('/monitors') })
export const useCompanySessions = () => useQuery({ queryKey: ['sessions', 'all'], queryFn: () => api.get<DriverSession[]>('/sessions') })
export const useCompanyStudents = () => useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
export const useCompanyAssignments = () => useQuery({ queryKey: ['assignments'], queryFn: () => api.get<Assignment[]>('/assignments') })
export const useCompanyVans = () => useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })
export const useSchools = () => useQuery({ queryKey: ['schools'], queryFn: () => api.get<SchoolSummary[]>('/schools') })
export const useAbsentToday = () =>
  useQuery({ queryKey: ['dashboard-absent-today'], queryFn: () => api.get<AbsentTodayEntry[]>('/dashboard/absent-today') })
