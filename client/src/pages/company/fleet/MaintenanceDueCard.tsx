import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { Card, CardHeader, CardTitle } from '../../../components/Card'
import { StatusBadge } from '../../../components/StatusBadge'
import type { DueItem } from '../../../types/api'
import { dueLine, stateBadge } from './fleetText'

// Fleet page: what is overdue and what is due soon, across every van. Click a row to open the van.
export function MaintenanceDueCard({ onOpenVan }: { onOpenVan: (vanId: string) => void }) {
  const q = useQuery({ queryKey: ['fleet', 'due'], queryFn: () => api.get<{ overdue: DueItem[]; due_soon: DueItem[] }>('/fleet/due') })
  const rows = [...(q.data?.overdue ?? []), ...(q.data?.due_soon ?? [])]
  return (
    <Card>
      <CardHeader>
        <CardTitle>Maintenance</CardTitle>
        <span className="text-[13px] text-muted">
          {q.data ? `${q.data.overdue.length} overdue · ${q.data.due_soon.length} due soon` : ''}
        </span>
      </CardHeader>
      {q.isLoading ? (
        <p className="border-t border-divider px-5 py-4 text-[14px] text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="border-t border-divider px-5 py-4 text-[14px] text-muted">Nothing due soon. Open a van to set its dates and mileage targets.</p>
      ) : (
        <ul>
          {rows.map((i) => {
            const badge = stateBadge(i)
            return (
              <li key={i.id} className="border-t border-divider">
                <button type="button" onClick={() => onOpenVan(i.van_id)} className="flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left hover:bg-surface-2/60">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] font-medium text-ink">
                      {i.van_label} · {i.name}
                    </span>
                    <span className="text-[13px] text-muted">{dueLine(i)}</span>
                  </span>
                  {badge && <StatusBadge tone={badge.tone} label={badge.label} />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
