import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import type { ColorValue } from 'react-native'

// The design specifies Material Symbols Outlined; @expo/vector-icons ships Material Icons,
// which has the same glyph set under kebab-case names (`receipt_long` → `receipt-long`).
export type IconName = keyof typeof MaterialIcons.glyphMap

export function Icon({
  name,
  size = 20,
  color,
}: {
  name: IconName
  size?: number
  // ColorValue, not string: React Navigation's tabBarIcon hands us its own colour value.
  color: ColorValue
}) {
  return <MaterialIcons name={name} size={size} color={color} />
}
