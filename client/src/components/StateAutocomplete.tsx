import { useState } from 'react'
import { Input } from './Input'
import { US_STATES } from '../data/usStates'

interface StateAutocompleteProps {
  id?: string
  value: string
  onChange: (code: string) => void
  required?: boolean
}

// Type-ahead state picker: type a prefix of the code or name, click a match to select it.
// Mirrors the inline claim-search pattern in RegisterPage.tsx (input + filtered list below).
export function StateAutocomplete({ id, value, onChange, required }: StateAutocompleteProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const selected = US_STATES.find((s) => s.code === value)
  const displayValue = open ? query : selected ? `${selected.name} (${selected.code})` : query

  const matches =
    query.trim().length > 0
      ? US_STATES.filter(
          (s) => s.code.toLowerCase().startsWith(query.trim().toLowerCase()) || s.name.toLowerCase().startsWith(query.trim().toLowerCase())
        )
      : []

  function select(code: string) {
    onChange(code)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        id={id}
        required={required}
        value={displayValue}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange('') // typing invalidates any prior selection until a match is clicked
        }}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
        placeholder="Start typing a state…"
        autoComplete="off"
      />
      {open && query.trim().length > 0 && (
        <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-row border border-line bg-surface p-1">
          {matches.length ? (
            matches.map((s) => (
              <button
                key={s.code}
                type="button"
                onClick={() => select(s.code)}
                className="rounded-row px-2.5 py-1.5 text-left text-[14px] text-ink transition-colors hover:bg-surface-2"
              >
                {s.name} ({s.code})
              </button>
            ))
          ) : (
            <p className="p-2 text-[13px] text-muted">No matching state</p>
          )}
        </div>
      )}
    </div>
  )
}
