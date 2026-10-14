import { AddressText } from '../../components/AddressText'
import { CallButton } from '../../components/mobile'
import type { RunMonitor, ShiftPeriod } from '../../types/api'

// The monitor(s) riding on this run, shown first on the run: the driver picks them up at their
// home address before the first student stop. Name, phone (tap to call) and the address (tap to
// copy). Nothing at all when no monitor rides this run.
export function MonitorStops({ monitors, period, compact = false }: { monitors: RunMonitor[]; period: ShiftPeriod; compact?: boolean }) {
  if (monitors.length === 0) return null
  return (
    <section aria-label={`Monitor pickup, ${period}`} className={compact ? 'border-t border-divider' : 'overflow-hidden rounded-m border border-line bg-surface shadow-card'}>
      {monitors.map((m, i) => (
        <div key={m.id} className={`flex items-center gap-3 px-3.5 py-3 ${i ? 'border-t border-divider' : ''}`}>
          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-info-bg text-info-fg">
            <span className="material-symbols-outlined !text-[16px]">badge</span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="text-[12px] font-semibold text-muted">Pick up first · Your monitor</span>
            <span className="truncate text-[14px] font-medium text-ink">{m.full_name}</span>
            <span className="text-[13px] text-muted tabular">{m.phone ?? 'No phone on file'}</span>
            {m.address ? <AddressText address={m.address} /> : <span className="text-[13px] text-muted">No address on file</span>}
          </span>
          {m.phone && <CallButton phone={m.phone} label={`Call ${m.full_name}`} />}
        </div>
      ))}
    </section>
  )
}
