import Svg, { G, Path } from 'react-native-svg'
import { useTheme } from '@/theme/theme'
import {
  ARROW_HEAD_PATH,
  ARROW_STEM_PATH,
  ARROW_STROKE_WIDTH,
  LOCKUP_ASPECT,
  LOCKUP_VIEWBOX,
  MARK_ASPECT,
  MARK_VIEWBOX,
  NAME_TRANSFORM,
  SAFE_PATH,
  SHIELD_PATH,
  TURNS_PATH,
} from './logoPaths'
import { logoColors, type LogoSurface } from './logoColors'

// The SafeTurns logo (design-reference/brand/safeturns-logo), same props as the web one.
// Light theme = amber, dark theme = evergreen; `surface` is what is behind it ("auto" = a surface
// that flips with the theme, like the screen background). Sized by height; width follows.
export function Logo({
  kind = 'lockup',
  surface = 'auto',
  height = 36,
  accessibilityLabel = 'SafeTurns',
}: {
  kind?: 'mark' | 'lockup'
  surface?: LogoSurface
  height?: number
  accessibilityLabel?: string
}) {
  const { isDark } = useTheme()
  const c = logoColors(isDark, surface)
  const lockup = kind === 'lockup'
  const arrow = { fill: 'none', stroke: c.arrow, strokeWidth: ARROW_STROKE_WIDTH, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <Svg
      width={height * (lockup ? LOCKUP_ASPECT : MARK_ASPECT)}
      height={height}
      viewBox={lockup ? LOCKUP_VIEWBOX : MARK_VIEWBOX}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <Path d={SHIELD_PATH} fill={c.shield} />
      <Path d={ARROW_STEM_PATH} {...arrow} />
      <Path d={ARROW_HEAD_PATH} {...arrow} />
      {lockup ? (
        <G transform={NAME_TRANSFORM}>
          <Path d={SAFE_PATH} fill={c.safe} />
          <Path d={TURNS_PATH} fill={c.turns} />
        </G>
      ) : null}
    </Svg>
  )
}
