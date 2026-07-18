import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'outline' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

// DESIGN.md "Components > Buttons": primary is Safety Amber / dark text, bold and
// high-contrast; secondary is deep slate; a subtle inner top highlight gives a
// pressable, tactile quality without looking skeuomorphic.
const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-primary-container text-on-primary-fixed shadow-sm hover:opacity-90',
  secondary: 'bg-secondary text-on-secondary hover:opacity-90',
  outline: 'border border-outline text-on-surface hover:bg-surface-container',
  danger: 'bg-error text-on-error hover:opacity-90',
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex h-14 items-center justify-center gap-2 rounded-lg text-title-lg font-bold transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  )
}
