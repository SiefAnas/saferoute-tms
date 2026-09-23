import type { ReactNode } from 'react'
import type { BadgeTone } from './StatusBadge'

// README global rule 5: an empty state is always an icon tile, a one-line title, one line of
// explanation, and a next-step button where there is one. Never plain grey text.
const TILE_TONES: Record<BadgeTone | 'plain', string> = {
  success: 'bg-success-bg text-success-fg',
  caution: 'bg-caution-bg text-caution-fg',
  alert: 'bg-alert-bg text-alert-fg',
  info: 'bg-info-bg text-info-fg',
  neutral: 'bg-neutral-bg text-neutral-fg',
  next: 'bg-next-bg text-next-fg',
  plain: 'border border-line bg-surface text-muted',
}

export function IconTile({ icon, tone = 'neutral', size = 36 }: { icon: string; tone?: BadgeTone | 'plain'; size?: 36 | 48 }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center ${size === 48 ? 'h-12 w-12 rounded-[12px]' : 'h-9 w-9 rounded-[10px]'} ${TILE_TONES[tone]}`}
    >
      <span className={`material-symbols-outlined ${size === 48 ? '!text-[24px]' : '!text-[20px]'}`}>{icon}</span>
    </span>
  )
}

// Centered: a whole card or page with nothing in it.
export function EmptyState({
  icon,
  title,
  body,
  action,
  tone = 'plain',
  className = '',
}: {
  icon: string
  title: string
  body?: string
  action?: ReactNode
  tone?: BadgeTone | 'plain'
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center gap-3 px-6 py-9 text-center ${className}`}>
      <IconTile icon={icon} tone={tone} size={48} />
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {body && <p className="max-w-[24rem] text-[13px] leading-normal text-pretty text-muted">{body}</p>}
      {action}
    </div>
  )
}

// Inline: one section of a drawer or card with nothing in it ("No adjustments this cycle.").
export function InlineEmpty({ icon, text, tone = 'neutral' }: { icon: string; text: string; tone?: BadgeTone }) {
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-line bg-empty p-3.5">
      <IconTile icon={icon} tone={tone} />
      <span className="text-[13px] text-muted">{text}</span>
    </div>
  )
}
