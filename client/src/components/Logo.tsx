import {
  ARROW_HEAD_PATH,
  ARROW_STEM_PATH,
  ARROW_STROKE_WIDTH,
  LOCKUP_VIEWBOX,
  MARK_VIEWBOX,
  NAME_TRANSFORM,
  SAFE_PATH,
  SHIELD_PATH,
  TURNS_PATH,
} from './logoPaths'

// The SafeTurns logo (design-reference/brand/safeturns-logo). `kind`: the shield alone ("mark")
// or shield + name ("lockup"). `surface`: what is behind it: "light", "dark", or "auto" for
// surfaces that flip with the theme. Colors come from the --logo-* variables in index.css
// (amber in the light theme, evergreen in the dark one). Size it by height (e.g. className
// "h-9"); the width follows the viewBox.
export function Logo({
  kind = 'lockup',
  surface = 'auto',
  className = '',
}: {
  kind?: 'mark' | 'lockup'
  surface?: 'light' | 'dark' | 'auto'
  className?: string
}) {
  const c = (part: 'shield' | 'arrow' | 'safe' | 'turns') => `var(--logo-${surface}-${part})`
  const arrow = { fill: 'none', stroke: c('arrow'), strokeWidth: ARROW_STROKE_WIDTH, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg
      viewBox={kind === 'mark' ? MARK_VIEWBOX : LOCKUP_VIEWBOX}
      role="img"
      aria-label="SafeTurns"
      className={`block w-auto shrink-0 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={SHIELD_PATH} fill={c('shield')} />
      <path d={ARROW_STEM_PATH} {...arrow} />
      <path d={ARROW_HEAD_PATH} {...arrow} />
      {kind === 'lockup' && (
        <g transform={NAME_TRANSFORM}>
          <path d={SAFE_PATH} fill={c('safe')} />
          <path d={TURNS_PATH} fill={c('turns')} />
        </g>
      )}
    </svg>
  )
}
