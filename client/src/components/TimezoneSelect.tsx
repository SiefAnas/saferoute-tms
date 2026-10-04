import { useMemo, useState } from 'react'
import { Input } from './Input'
import { zoneHint } from '../lib/timezone'

// Every IANA zone the browser knows, plus UTC (Intl's own list leaves it out). The server checks
// the choice again against its own Intl and Postgres lists.
function allZones(): string[] {
  const list = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return Array.from(new Set([...list, 'UTC'])).sort()
}

const norm = (s: string) => s.toLowerCase().replace(/_/g, ' ')

// Searchable timezone picker (not free text): type any part of the name ("chicago", "new york",
// "europe/"), click a match to select it. Same interaction as StateAutocomplete.
export function TimezoneSelect({ id, value, onChange }: { id?: string; value: string; onChange: (zone: string) => void }) {
  const zones = useMemo(allZones, [])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const q = norm(query.trim())
  const matches = q ? zones.filter((z) => norm(z).includes(q)).slice(0, 50) : []

  function select(zone: string) {
    onChange(zone)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open && q.length > 0}
        aria-autocomplete="list"
        value={open ? query : value}
        onFocus={() => setOpen(true)}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
        placeholder="Search a city or region, like Chicago"
        autoComplete="off"
      />
      {open && q.length > 0 && (
        <div role="listbox" className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-row border border-line bg-surface p-1">
          {matches.length ? (
            matches.map((z) => (
              <button
                key={z}
                type="button"
                role="option"
                aria-selected={z === value}
                onClick={() => select(z)}
                className="flex items-center justify-between gap-3 rounded-row px-2.5 py-1.5 text-left text-[14px] text-ink transition-colors hover:bg-surface-2"
              >
                <span>{z.replace(/_/g, ' ')}</span>
                <span className="shrink-0 text-[12px] text-muted">{zoneHint(z)}</span>
              </button>
            ))
          ) : (
            <p className="p-2 text-[13px] text-muted">No matching time zone</p>
          )}
        </div>
      )}
    </div>
  )
}
