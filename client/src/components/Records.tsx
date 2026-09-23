import type { CSSProperties, ReactNode } from 'react'
import { Card, CardHeader, CardTitle } from './Card'

// Shared pieces of the refresh's records-page template (design 5a): stat cards, the slate
// "live" hero stat, a flat table card with a tinted header row and 58px rows, avatars, and the
// top-bar search field. Tables are CSS grids (one `columns` template shared by the header and
// every row) rather than <table>, matching the design's fixed column widths.

export function initialsOf(name: string | null | undefined) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function Avatar({ name, size = 32 }: { name: string | null | undefined; size?: 30 | 32 | 44 }) {
  const cls = size === 44 ? 'h-11 w-11 text-[15px]' : size === 30 ? 'h-[30px] w-[30px] text-[11px]' : 'h-8 w-8 text-[11px]'
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-avatar font-bold text-on-avatar ${cls}`}>
      {initialsOf(name)}
    </span>
  )
}

// First column of most tables: avatar + name + a sub line.
export function NameCell({ name, sub, avatar = true }: { name: ReactNode; sub?: ReactNode; avatar?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {avatar && <Avatar name={typeof name === 'string' ? name : null} />}
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[14px] font-semibold text-ink">{name}</span>
        {sub && <span className="truncate text-[12px] text-muted">{sub}</span>}
      </div>
    </div>
  )
}

type Tone = 'default' | 'caution' | 'alert' | 'success'
const FIGURE_TONE: Record<Tone, string> = {
  default: 'text-ink',
  caution: 'text-caution-fg',
  alert: 'text-alert-fg',
  success: 'text-success-fg',
}

export function StatCard({
  label,
  value,
  sub,
  tone = 'default',
  subTone = 'default',
  disabled = false,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
  subTone?: Tone
  disabled?: boolean
}) {
  return (
    <Card className={`flex min-w-0 flex-col gap-1.5 px-5 py-[18px] ${disabled ? 'opacity-70' : ''}`}>
      <span className="text-[13px] text-muted">{label}</span>
      <span className={`text-stat-figure ${FIGURE_TONE[tone]}`}>{value}</span>
      {sub && (
        <span className={`truncate text-[13px] ${subTone === 'default' ? 'text-muted' : `font-semibold ${FIGURE_TONE[subTone]}`}`}>{sub}</span>
      )}
    </Card>
  )
}

// Live-status panel: slate fill, amber figure (README rule 3).
export function HeroStat({ label, value, sub, children }: { label: string; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-card bg-hero px-5 py-[18px] text-hero-ink shadow-hero">
      <span className="text-[13px] text-hero-muted">{label}</span>
      <span className="text-hero-figure text-amber-soft">{value}</span>
      {sub && <span className="text-[13px] text-hero-sub">{sub}</span>}
      {children}
    </div>
  )
}

export interface Column {
  label: string
  align?: 'left' | 'right'
}

// Flat record table: optional title row, tinted header row, hairline-divided rows. Scrolls
// sideways on narrow screens instead of squashing columns.
export function TableCard({
  title,
  hint,
  columns,
  template,
  minWidth = 760,
  children,
}: {
  title?: ReactNode
  hint?: ReactNode
  columns: Column[]
  template: string
  minWidth?: number
  children: ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      {title && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {hint && <span className="text-[12px] text-muted">{hint}</span>}
        </CardHeader>
      )}
      <div className="overflow-x-auto">
        <div style={{ minWidth }}>
          <div
            className="grid gap-3 bg-table-head px-5 py-2.5 text-[12px] font-semibold text-muted"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((c, i) => (
              <span key={i} className={c.align === 'right' ? 'text-right' : ''}>
                {c.label}
              </span>
            ))}
          </div>
          {children}
        </div>
      </div>
    </Card>
  )
}

export function TableRow({
  template,
  onClick,
  selected = false,
  children,
  className = '',
  style,
}: {
  template: string
  onClick?: () => void
  selected?: boolean
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const interactive = Boolean(onClick)
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      className={`grid min-h-[58px] items-center gap-3 border-t border-divider px-5 py-2 text-[14px] ${
        selected ? 'bg-row-selected' : ''
      } ${interactive ? 'cursor-pointer outline-none hover:bg-row-hover focus-visible:bg-row-hover' : ''} ${className}`}
      style={{ gridTemplateColumns: template, ...style }}
    >
      {children}
    </div>
  )
}

// Stops a click on a row's own button from also opening the row's drawer.
export function stop(e: { stopPropagation: () => void }) {
  e.stopPropagation()
}

// Top-bar search: 260px, 38px, search icon, filters rows client-side.
export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="relative flex h-[38px] w-full items-center sm:w-[260px]">
      <span className="material-symbols-outlined pointer-events-none absolute left-2.5 !text-[18px] text-muted">search</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full w-full rounded-btn border border-outline bg-surface pr-3 pl-9 text-[13px] text-ink outline-none placeholder:text-faint focus:border-amber focus:ring-2 focus:ring-amber/20"
      />
    </label>
  )
}

// Stat row: three (or more) cards side by side on wide screens, stacked on phones.
export function StatRow({ template = '1fr 1fr 1fr', children }: { template?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:[grid-template-columns:var(--stat-cols)]" style={{ ['--stat-cols' as string]: template }}>
      {children}
    </div>
  )
}

// Web segmented control (dashboard Morning / Afternoon): tinted track, the active option
// raised on a surface chip.
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-[3px] rounded-m border border-line bg-table-head p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-8 cursor-pointer rounded-row px-3.5 text-[13px] font-semibold transition-colors ${
            value === o.value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Rounded filter chip ("All / On shift / Not in").
export function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-7 cursor-pointer rounded-[14px] border border-line px-2.5 text-[12px] font-semibold ${
        active ? 'bg-ink text-surface' : 'bg-surface text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

// Case-insensitive "does any of these fields contain the search text".
export function matches(q: string, ...fields: (string | null | undefined)[]) {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return fields.some((f) => f?.toLowerCase().includes(needle))
}

// Search empty state (5a): icon tile, 'No matches for "{q}"', a hint and "Clear search".
export function NoMatches({ q, hint, onClear }: { q: string; hint: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 border-t border-divider px-6 py-9 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-neutral-bg text-neutral-fg">
        <span className="material-symbols-outlined !text-[24px]">search_off</span>
      </span>
      <p className="text-[15px] font-semibold text-ink">No matches for &ldquo;{q}&rdquo;</p>
      <p className="max-w-sm text-[13px] text-muted">{hint}</p>
      <button
        type="button"
        onClick={onClear}
        className="h-8 cursor-pointer rounded-[7px] border border-outline bg-outline-bg px-3 text-[13px] font-medium text-ink hover:bg-surface-2"
      >
        Clear search
      </button>
    </div>
  )
}

// One-line page description under the top bar.
export function PageIntro({ children }: { children: ReactNode }) {
  return <p className="text-[14px] text-muted">{children}</p>
}
