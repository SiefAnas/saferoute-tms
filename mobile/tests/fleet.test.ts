import type { MaintenanceItem } from '@/api/types'
import { dueLine, fuelBody, stateBadge } from '@/features/fleet/text'

const item = (over: Partial<MaintenanceItem>): MaintenanceItem => ({
  id: 'i',
  name: 'Oil change',
  builtin_key: 'oil_change',
  schedule_type: 'mileage',
  interval_days: null,
  interval_miles: 5000,
  due_date: null,
  due_miles: null,
  is_active: true,
  state: 'not_set',
  ...over,
})

describe('dueLine', () => {
  it('mileage: to go, over, no reading', () => {
    expect(dueLine(item({ state: 'due_soon', due_miles: 10000, miles_left: 400 }))).toBe('400 mi to go (at 10,000 mi)')
    expect(dueLine(item({ state: 'overdue', due_miles: 10000, miles_left: -100 }))).toBe('100 mi over (due at 10,000 mi)')
    expect(dueLine(item({ state: 'no_reading', due_miles: 10000 }))).toBe('Due at 10,000 mi · no odometer reading yet')
  })
  it('date: in N days, today, overdue', () => {
    const d = item({ schedule_type: 'date', due_date: '2026-11-01', interval_miles: null })
    expect(dueLine({ ...d, state: 'due_soon', days_left: 12 })).toBe('Due in 12 days (Nov 1, 2026)')
    expect(dueLine({ ...d, state: 'due_soon', days_left: 0 })).toBe('Due today (Nov 1, 2026)')
    expect(dueLine({ ...d, state: 'overdue', days_left: -1 })).toBe('1 day overdue (Nov 1, 2026)')
  })
  it('off and not set', () => {
    expect(dueLine(item({ state: 'off' }))).toBe('Turned off')
    expect(dueLine(item({}))).toBe('No mileage target set')
  })
})

describe('stateBadge', () => {
  it('overdue is an alert, due soon a caution, not set has none', () => {
    expect(stateBadge(item({ state: 'overdue' }))?.tone).toBe('alert')
    expect(stateBadge(item({ state: 'due_soon' }))?.tone).toBe('caution')
    expect(stateBadge(item({}))).toBeNull()
  })
})

describe('fuelBody (driver fuel form)', () => {
  it('miles required, whole number', () => {
    expect(fuelBody('', '', '').ok).toBe(false)
    expect(fuelBody('12.5', '', '').ok).toBe(false)
  })
  it('gallons and cost optional', () => {
    expect(fuelBody('45210', '', '')).toEqual({ ok: true, body: { miles: 45210, gallons: null, cost: null } })
    expect(fuelBody('45210', '18,5', '64.20')).toEqual({ ok: true, body: { miles: 45210, gallons: 18.5, cost: 64.2 } })
  })
  it('refuses nonsense numbers', () => {
    expect(fuelBody('45210', '0', '').ok).toBe(false)
    expect(fuelBody('45210', '', '-3').ok).toBe(false)
  })
})
