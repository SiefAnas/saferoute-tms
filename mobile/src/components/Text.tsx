import { Text as RNText, type StyleProp, type TextProps, type TextStyle } from 'react-native'
import { font } from '@/theme/tokens'
import { useColors } from '@/theme/theme'

type Weight = 'regular' | 'medium' | 'semibold' | 'bold'

const FAMILY: Record<Weight, string> = {
  regular: font.regular,
  medium: font.medium,
  semibold: font.semibold,
  bold: font.bold,
}

interface Props extends TextProps {
  size?: number
  weight?: Weight
  color?: string
  // Times and money line up in columns (design: font-variant-numeric: tabular-nums).
  tabular?: boolean
  style?: StyleProp<TextStyle>
}

// Inter at a given size/weight. Weight is chosen by font family, not fontWeight, because a
// loaded static font per weight renders identically on both platforms.
export function Text({ size = 14, weight = 'regular', color, tabular, style, ...rest }: Props) {
  const colors = useColors()
  return (
    <RNText
      {...rest}
      style={[
        {
          fontFamily: FAMILY[weight],
          fontSize: size,
          color: color ?? colors.ink,
          ...(tabular ? { fontVariant: ['tabular-nums' as const] } : null),
        },
        style,
      ]}
    />
  )
}
