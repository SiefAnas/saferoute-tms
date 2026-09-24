// Weekday labels, ported from client/src/lib/weekdays.ts. ISO numbers: 1 = Monday ... 7 = Sunday.
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// "Mon–Fri", "Every day", "Sat, Sun", "Mon, Wed, Fri". Runs of 3+ days in a row become a range.
export function formatWeekdays(days: readonly number[] | undefined): string {
  const set = [...new Set(days ?? [1, 2, 3, 4, 5])].sort((a, b) => a - b)
  if (set.length === 7) return 'Every day'
  const parts: string[] = []
  for (let i = 0; i < set.length; ) {
    let j = i
    while (j + 1 < set.length && set[j + 1] === (set[j] ?? 0) + 1) j++
    const name = (n: number | undefined) => SHORT[(n ?? 1) - 1] ?? ''
    if (j - i >= 2) parts.push(`${name(set[i])}–${name(set[j])}`)
    else for (let k = i; k <= j; k++) parts.push(name(set[k]))
    i = j + 1
  }
  return parts.join(', ')
}
