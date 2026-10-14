import type { MonitorStop, MonitorStopAction, MonitorStopStatus } from '@/api/types'
import type { ToneName } from '@/theme/tokens'

// Pure rules for the monitor stop buttons (branch monitor-crew-status), kept apart so they can be
// unit tested. The server enforces the same rules (server/src/services/monitorStops.js).

// Which buttons the driver sees. Nothing here ever blocks the student stops.
//  - waiting (pending / running late): Running late, No show, Picked up, Dropped off
//  - no show: Picked up (the monitor turned up after all)
//  - picked up: Dropped off (any time, usually the end of the run)
//  - dropped off: nothing left
export function driverActions(status: MonitorStopStatus): MonitorStopAction[] {
  switch (status) {
    case 'pending':
    case 'late':
      return ['running_late', 'no_show', 'picked_up', 'dropped_off']
    case 'no_show':
      return ['picked_up']
    case 'picked_up':
      return ['dropped_off']
    default:
      return []
  }
}

// The badge on the monitor stop; `clock` formats an ISO time for display.
export function stopBadge(stop: MonitorStop | null | undefined, clock: (iso: string) => string): { label: string; tone: ToneName } | null {
  if (!stop) return null
  switch (stop.status) {
    case 'dropped_off':
      return { label: `Dropped off ${clock(stop.dropped_off_at!)}`, tone: 'success' }
    case 'picked_up':
      return { label: `Picked up ${clock(stop.picked_up_at!)}`, tone: 'success' }
    case 'no_show':
      return { label: 'No show', tone: 'alert' }
    case 'late':
      return { label: stop.late_reported_by === 'monitor' ? 'Monitor running late' : 'You said running late', tone: 'caution' }
    default:
      return null
  }
}

// The monitor's own "I'm running late" button: only while they are still waiting to be picked up.
export const canReportLate = (stop: MonitorStop | null | undefined) => !stop || stop.status === 'pending' || stop.status === 'late'
