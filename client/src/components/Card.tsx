import type { ReactNode } from 'react'

// Refresh cards (README "Elevation"): web cards are a white/slate surface on a soft shadow, no
// border, radius 14; inside the mobile shells the same component becomes a hairline-bordered
// radius-10 card. Both come from index.css tokens (card-line / radius-card / shadow-card).
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card border border-card-line bg-surface shadow-card ${className}`}>{children}</div>
}

// Card title row: "Drivers · current cycle" on the left, a hint or control on the right.
export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 border-b border-divider px-5 py-3.5 ${className}`}>{children}</div>
  )
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-card-title text-ink">{children}</h2>
}
