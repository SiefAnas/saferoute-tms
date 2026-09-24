import { WEEKDAYS } from '../lib/weekdays'

// Checkboxes for the days an assignment runs (Mon ... Sun). At least one day must stay picked:
// the last checked box can't be unticked.
export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  function toggle(n: number) {
    if (value.includes(n)) {
      if (value.length > 1) onChange(value.filter((d) => d !== n))
    } else {
      onChange([...value, n].sort((a, b) => a - b))
    }
  }
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="pb-1.5 text-[12px] font-semibold text-muted">Days it runs</legend>
      <div className="flex flex-wrap gap-1.5">
        {WEEKDAYS.map((d) => {
          const on = value.includes(d.n)
          return (
            <label
              key={d.n}
              title={d.long}
              className={`flex h-9 min-w-[52px] cursor-pointer items-center justify-center gap-1.5 rounded-btn border px-2.5 text-[13px] font-medium ${
                on ? 'border-amber bg-row-selected text-ink' : 'border-line bg-surface text-muted'
              }`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(d.n)}
                aria-label={d.long}
                className="h-3.5 w-3.5 accent-amber"
              />
              {d.short}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
