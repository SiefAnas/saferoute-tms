import { useColors } from '@/theme/theme'
import { Text } from './Text'

// The copyright line at the bottom of every screen (Screen) and the sign-in screen. Same
// wording as the website's footer.
export const COPYRIGHT = '© 2026 Anas Sief. All rights reserved.'

export function Copyright() {
  const colors = useColors()
  return (
    <Text size={12} color={colors.faint} style={{ textAlign: 'center', paddingVertical: 16 }}>
      {COPYRIGHT}
    </Text>
  )
}
