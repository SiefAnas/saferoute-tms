import { View } from 'react-native'
import { useColors } from '@/theme/theme'
import { initials } from '@/lib/format'
import { Text } from './Text'

export function Avatar({ name, size = 44 }: { name: string | null | undefined; size?: number }) {
  const colors = useColors()
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.avatar,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text size={Math.round(size * 0.34)} weight="semibold" color={colors.onAvatar}>
        {initials(name)}
      </Text>
    </View>
  )
}
