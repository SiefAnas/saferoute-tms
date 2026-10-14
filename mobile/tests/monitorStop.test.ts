import type { MonitorStop } from '@/api/types'
import { canReportLate, driverActions, stopBadge } from '@/features/driver/monitorStop'
import { alertLines } from '@/features/notifications/logic'

const clock = (iso: string) => iso.slice(11, 16)
const stop = (over: Partial<MonitorStop>): MonitorStop => ({
  status: 'pending',
  picked_up_at: null,
  no_show_at: null,
  dropped_off_at: null,
  late_reported_at: null,
  late_reported_by: null,
  escalate_at: null,
  ...over,
})

describe('driverActions (the monitor stop buttons)', () => {
  it('waiting: running late, no show, picked up, and dropped off any time', () => {
    expect(driverActions('pending')).toEqual(['running_late', 'no_show', 'picked_up', 'dropped_off'])
    expect(driverActions('late')).toEqual(['running_late', 'no_show', 'picked_up', 'dropped_off'])
  })
  it('after a no show only "picked up" (they turned up after all)', () => {
    expect(driverActions('no_show')).toEqual(['picked_up'])
  })
  it('after pickup only "dropped off"; then nothing', () => {
    expect(driverActions('picked_up')).toEqual(['dropped_off'])
    expect(driverActions('dropped_off')).toEqual([])
  })
})

describe('stopBadge', () => {
  it('nothing pressed: no badge', () => {
    expect(stopBadge(null, clock)).toBeNull()
    expect(stopBadge(stop({}), clock)).toBeNull()
  })
  it('says who is running late', () => {
    expect(stopBadge(stop({ status: 'late', late_reported_by: 'monitor' }), clock)?.label).toBe('Monitor running late')
    expect(stopBadge(stop({ status: 'late', late_reported_by: 'driver' }), clock)?.label).toBe('You said running late')
  })
  it('no show is an alert; pickup and drop-off show the time', () => {
    expect(stopBadge(stop({ status: 'no_show' }), clock)).toEqual({ label: 'No show', tone: 'alert' })
    expect(stopBadge(stop({ status: 'picked_up', picked_up_at: '2026-10-14T07:12:00Z' }), clock)?.label).toBe('Picked up 07:12')
    expect(stopBadge(stop({ status: 'dropped_off', dropped_off_at: '2026-10-14T08:05:00Z' }), clock)?.label).toBe('Dropped off 08:05')
  })
})

describe('canReportLate (the monitor\'s own button)', () => {
  it('only while still waiting to be picked up', () => {
    expect(canReportLate(null)).toBe(true)
    expect(canReportLate(stop({ status: 'late' }))).toBe(true)
    expect(canReportLate(stop({ status: 'picked_up' }))).toBe(false)
    expect(canReportLate(stop({ status: 'no_show' }))).toBe(false)
  })
})

describe('alertLines (admin red banner)', () => {
  it('names the monitor, the driver, the run and what happened', () => {
    const lines = alertLines(
      {
        body: "Dana Driver's morning run (Van 12): Dana Driver marked Nia Monitor as a no show.",
        sent_at: '2026-10-14T07:40:00Z',
        data: { event: 'no_show', driver_name: 'Dana Driver', monitor_name: 'Nia Monitor', shift_period: 'morning', van: 'Van 12' },
      },
      clock,
    )
    expect(lines.title).toBe('Monitor no show: Nia Monitor · 07:40')
    expect(lines.detail).toBe("Dana Driver's morning run (Van 12): Dana Driver marked Nia Monitor as a no show.")
  })
})
