import type { ReactNode } from 'react'

// DESIGN.md "Components > Cards": white surface, 1px outline-variant border, soft radius.
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-outline-variant bg-surface-container-lowest ${className}`}>
      {children}
    </div>
  )
}

export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex items-center justify-between border-b border-outline-variant bg-surface-bright px-6 py-4 ${className}`}
    >
      {children}
    </div>
  )
}
