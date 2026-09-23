import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'outline' | 'danger'
// Overnight task: most buttons in the app were rendering at the same oversized h-14 with
// bold title-size text regardless of what they did — the "Sign In" button and a modal's
// "Cancel" button looked equally important. 'md' (the new default) is the normal size for
// everything; 'lg' is reserved for the one primary action of a screen that deserves the old
// full-size treatment (Login/Register's single submit, the driver's own Check In/Check Out).
type Size = 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
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

// 'lg' matches the old always-on default exactly (h-14, title-lg, bold, no baked-in
// horizontal padding — every 'lg' call site already controls its own width). 'md' is a
// real normal button size: shorter, semibold rather than bold, and its own sensible
// padding so a bare `<Button>New Thing</Button>` doesn't rely on the browser's default.
const SIZE_CLASSES: Record<Size, string> = {
  md: 'h-10 px-4 text-label-md font-semibold',
  lg: 'h-14 text-title-lg font-bold',
}

export function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  )
}
