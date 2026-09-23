import { Alert, Linking, Pressable } from 'react-native'
import { useColors } from '@/theme/theme'
import { telHref } from '@/lib/format'
import { Icon } from './Icon'

// 40px call button from the design: filled for the primary contact, outline for the rest.
export function CallButton({ phone, label, primary = false }: { phone: string; label: string; primary?: boolean }) {
  const colors = useColors()

  async function dial() {
    const url = telHref(phone)
    try {
      await Linking.openURL(url)
    } catch {
      // A tablet or a phone with no dialler. Show the number so the driver can still use it.
      Alert.alert('Cannot start a call', `This device cannot place calls. The number is ${phone}.`)
    }
  }

  return (
    <Pressable
      onPress={dial}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? colors.callBg : colors.outlineBg,
        borderWidth: primary ? 0 : 1,
        borderColor: colors.outline,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name="call" size={20} color={primary ? colors.onCall : colors.ink} />
    </Pressable>
  )
}
