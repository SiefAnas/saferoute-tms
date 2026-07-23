interface MarkedDate {
  color: string // Tailwind bg-* class
  label?: string
}

interface MonthCalendarProps {
  year: number
  month: number // 1-indexed (1 = January), matching how callers naturally think of "this month"
  markedDates: Record<string, MarkedDate> // key: "YYYY-MM-DD"
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

// Reused for both a student's trip-history calendar and a driver's own worked-days
// calendar — no date library in this repo's dependencies, so this is plain Date math.
export function MonthCalendar({ year, month, markedDates }: MonthCalendarProps) {
  const firstOfMonth = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const leadingBlanks = firstOfMonth.getDay()

  const cells: Array<{ day: number; dateKey: string } | null> = []
  for (let i = 0; i < leadingBlanks; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, dateKey: `${year}-${pad2(month)}-${pad2(day)}` })
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-7 gap-1 text-center text-label-md text-on-surface-variant">
        {WEEKDAY_LABELS.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} />
          const marked = markedDates[cell.dateKey]
          return (
            <div
              key={cell.dateKey}
              title={marked?.label}
              className={`flex aspect-square items-center justify-center rounded-md text-body-md ${
                marked ? `${marked.color} text-white font-medium` : 'text-on-surface-variant'
              }`}
            >
              {cell.day}
            </div>
          )
        })}
      </div>
    </div>
  )
}
