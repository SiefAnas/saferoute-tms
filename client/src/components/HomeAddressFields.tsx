import { Field, Input } from './Input'
import { StateAutocomplete } from './StateAutocomplete'

// A monitor's home address: the same street / city / state / zip fields as a student's address
// (StudentsPage), where the driver picks the monitor up. The server takes the four together: all
// filled in, or all empty to remove the address (server/src/services/monitorAddress.js).
export interface HomeAddress {
  street_address: string
  city: string
  state: string
  zip_code: string
}

export function homeAddressOf(u: { street_address?: string | null; city?: string | null; state?: string | null; zip_code?: string | null }): HomeAddress {
  return { street_address: u.street_address ?? '', city: u.city ?? '', state: u.state ?? '', zip_code: u.zip_code ?? '' }
}

export const sameHomeAddress = (a: HomeAddress, b: HomeAddress) =>
  a.street_address === b.street_address && a.city === b.city && a.state === b.state && a.zip_code === b.zip_code

// PATCH body: the four trimmed, empty ones as null.
export function homeAddressBody(a: HomeAddress) {
  const v = (s: string) => s.trim() || null
  return { street_address: v(a.street_address), city: v(a.city), state: v(a.state), zip_code: v(a.zip_code) }
}

export function HomeAddressFields({
  value,
  onChange,
  label = 'Home address (pickup)',
  className = '',
}: {
  value: HomeAddress
  onChange: (a: HomeAddress) => void
  label?: string
  className?: string
}) {
  const set = (k: keyof HomeAddress) => (v: string) => onChange({ ...value, [k]: v })
  // Once one field is typed in, the rest are needed too.
  const required = Boolean(value.street_address || value.city || value.state || value.zip_code)
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Field label={label}>
        <Input required={required} placeholder="Street address" autoComplete="street-address" value={value.street_address} onChange={(e) => set('street_address')(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Input required={required} aria-label="City" placeholder="City" autoComplete="address-level2" value={value.city} onChange={(e) => set('city')(e.target.value)} />
        <div className="w-32 flex-none">
          <StateAutocomplete required={required} value={value.state} onChange={set('state')} />
        </div>
        <Input required={required} aria-label="Zip code" placeholder="Zip code" autoComplete="postal-code" value={value.zip_code} onChange={(e) => set('zip_code')(e.target.value)} />
      </div>
    </div>
  )
}
