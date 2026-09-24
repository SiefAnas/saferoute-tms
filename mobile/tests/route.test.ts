import { formatWeekdays } from '@/lib/weekdays'
import { homeEnd, isDifferent, legOf, placeName } from '@/lib/route'
import type { StudentRoute } from '@/api/types'

// The app only shows the route the server sends; these helpers decide how it reads.
const route: StudentRoute = {
  morning: { from: { kind: 'home', label: 'Home', address: '12 Oak St, Boston, MA 02139' }, to: { kind: 'school', label: 'Lincoln Elementary', address: null } },
  afternoon: { from: { kind: 'school', label: 'Lincoln Elementary', address: null }, to: { kind: 'extra', label: 'Grandparents', address: '5 Pine Rd, Quincy, MA 02169' } },
}

describe('route helpers', () => {
  it('names a school by its name and a home by its first address line', () => {
    expect(placeName(route.morning?.from)).toBe('12 Oak St')
    expect(placeName(route.morning?.to)).toBe('Lincoln Elementary')
    expect(placeName(undefined)).toBe('—')
  })
  it('flags only the leg with an extra address', () => {
    expect(isDifferent(legOf(route, 'morning'))).toBe(false)
    expect(isDifferent(legOf(route, 'afternoon'))).toBe(true)
  })
  it('the home end is the pickup in the morning and the drop-off in the afternoon', () => {
    expect(homeEnd(route.morning!, 'morning').kind).toBe('home')
    expect(homeEnd(route.afternoon!, 'afternoon').label).toBe('Grandparents')
  })
  it('a leg the assignment does not cover is null', () => {
    expect(legOf({ morning: route.morning, afternoon: null }, 'afternoon')).toBeNull()
  })
})

describe('weekday labels', () => {
  it('formats ranges, lists and every day', () => {
    expect(formatWeekdays([1, 2, 3, 4, 5])).toBe('Mon–Fri')
    expect(formatWeekdays([5])).toBe('Fri')
    expect(formatWeekdays([1, 3, 5])).toBe('Mon, Wed, Fri')
    expect(formatWeekdays([6, 7])).toBe('Sat, Sun')
    expect(formatWeekdays([1, 2, 3, 4, 5, 6, 7])).toBe('Every day')
  })
})
