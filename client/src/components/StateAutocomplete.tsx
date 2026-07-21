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
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-outline-variant p-2">
          {matches.length ? (
            matches.map((s) => (
              <button
                key={s.code}
                type="button"
                onClick={() => select(s.code)}
                className="rounded-lg px-3 py-2 text-left text-body-md transition-colors hover:bg-surface-container"
              >
                {s.name} ({s.code})
              </button>
            ))
          ) : (
            <p className="p-2 text-body-md text-on-surface-variant">No matching state</p>
          )}
        </div>
      )}
    </div>
  )
}
