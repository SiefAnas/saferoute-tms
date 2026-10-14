import { TextInput, View } from 'react-native'
import { Field, inputStyle } from '@/components/Form'
import { useColors } from '@/theme/theme'

// A monitor's home address: street / city / state / zip, the same fields as a student's address,
// where the driver picks the monitor up. The server takes the four together: all filled in, or
// all empty to remove it (server/src/services/monitorAddress.js), and checks the state and zip.
// Same as the website's client/src/components/HomeAddressFields.tsx.
export interface HomeAddress {
  street_address: string
  city: string
  state: string
  zip_code: string
}

export function homeAddressOf(u: { street_address?: string | null; city?: string | null; state?: string | null; zip_code?: string | null }): HomeAddress {
  return { street_address: u.street_address ?? '', city: u.city ?? '', state: u.state ?? '', zip_code: u.zip_code ?? '' }
}

// Request body: the four trimmed, empty ones as null.
export function homeAddressBody(a: HomeAddress) {
  const v = (s: string) => s.trim() || null
  return { street_address: v(a.street_address), city: v(a.city), state: v(a.state), zip_code: v(a.zip_code) }
}

export function HomeAddressInputs({ value, onChange, label = 'Home address' }: { value: HomeAddress; onChange: (a: HomeAddress) => void; label?: string }) {
  const colors = useColors()
  const input = inputStyle(colors.ink, colors.line, colors.surface)
  const set = (k: keyof HomeAddress) => (v: string) => onChange({ ...value, [k]: v })
  return (
    <Field label={label}>
      <TextInput
        value={value.street_address}
        onChangeText={set('street_address')}
        placeholder="Street address"
        placeholderTextColor={colors.faint}
        textContentType="fullStreetAddress"
        autoComplete="street-address"
        style={input}
        accessibilityLabel="Street address"
      />
      <TextInput
        value={value.city}
        onChangeText={set('city')}
        placeholder="City"
        placeholderTextColor={colors.faint}
        textContentType="addressCity"
        style={input}
        accessibilityLabel="City"
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          value={value.state}
          onChangeText={(v) => set('state')(v.toUpperCase())}
          placeholder="State (MA)"
          placeholderTextColor={colors.faint}
          autoCapitalize="characters"
          maxLength={2}
          textContentType="addressState"
          style={[input, { flex: 1 }]}
          accessibilityLabel="State, two letters"
        />
        <TextInput
          value={value.zip_code}
          onChangeText={set('zip_code')}
          placeholder="Zip code"
          placeholderTextColor={colors.faint}
          keyboardType="number-pad"
          maxLength={10}
          textContentType="postalCode"
          style={[input, { flex: 1 }]}
          accessibilityLabel="Zip code"
        />
      </View>
    </Field>
  )
}
