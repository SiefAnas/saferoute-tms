import type { InputHTMLAttributes } from 'react'

// DESIGN.md "Components > Inputs": outlined style, amber focus ring at 20% opacity.
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-14 w-full rounded-lg border border-outline bg-surface-container-lowest px-4 text-body-lg outline-none transition-all focus:border-primary-container focus:ring-2 focus:ring-primary-container/20 ${className}`}
      {...props}
    />
  )
}
