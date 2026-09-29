import { logoColors } from '@/components/logoColors'
import { LOCKUP_ASPECT, MARK_ASPECT } from '@/components/logoPaths'

// The logo follows the theme: light = amber, dark = evergreen; the surface picks on-light / on-dark.
describe('logoColors', () => {
  it('light theme is amber', () => {
    expect(logoColors(false, 'light')).toEqual({ shield: '#111318', arrow: '#F59E0B', safe: '#111318', turns: '#B86E00' })
    expect(logoColors(false, 'dark')).toEqual({ shield: '#F59E0B', arrow: '#111318', safe: '#FAF8F3', turns: '#F59E0B' })
  })
  it('dark theme is evergreen', () => {
    expect(logoColors(true, 'light')).toEqual({ shield: '#123C36', arrow: '#F5F0E6', safe: '#123C36', turns: '#23876A' })
    expect(logoColors(true, 'dark')).toEqual({ shield: '#F5F0E6', arrow: '#123C36', safe: '#F5F0E6', turns: '#8FD9B8' })
  })
  it('auto means on-light in the light theme and on-dark in the dark theme', () => {
    expect(logoColors(false, 'auto')).toEqual(logoColors(false, 'light'))
    expect(logoColors(true, 'auto')).toEqual(logoColors(true, 'dark'))
  })
  it('keeps the designer proportions (lockup width = height x 5.196)', () => {
    expect(LOCKUP_ASPECT).toBeCloseTo(5.196, 3)
    expect(MARK_ASPECT).toBeCloseTo(44 / 56, 5)
  })
})
