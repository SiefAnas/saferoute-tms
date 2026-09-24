import { useEffect, useState } from 'react'
import { Pressable, View, type StyleProp, type TextStyle } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Icon } from './Icon'
import { Text } from './Text'
import { useColors } from '@/theme/theme'

// An address the user can copy: tap or long-press copies it, and the line shows "Address
// copied" for a moment in place (in place, not a toast, so it also shows inside bottom sheets,
// which are native modals drawn above everything). Opening Apple Maps / Google Maps is V2.
export function AddressText({
  address,
  size = 13,
  color,
  style,
}: {
  address: string
  size?: number
  color?: string
  style?: StyleProp<TextStyle>
}) {
  const colors = useColors()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])
  const copy = async () => {
    await Clipboard.setStringAsync(address)
    setCopied(true)
  }
  return (
    <Pressable
      onPress={copy}
      onLongPress={copy}
      accessibilityRole="button"
      accessibilityLabel={`${address}. Tap to copy the address.`}
      accessibilityHint="Copies the address"
      hitSlop={6}
    >
      {copied ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessibilityLiveRegion="polite">
          <Icon name="check-circle" size={size + 2} color={colors.successFg} />
          <Text size={size} weight="medium" color={colors.successFg}>
            Address copied
          </Text>
        </View>
      ) : (
        <Text size={size} color={color ?? colors.muted} style={[{ textDecorationLine: 'underline', textDecorationStyle: 'dotted' }, style]}>
          {address}
        </Text>
      )}
    </Pressable>
  )
}
