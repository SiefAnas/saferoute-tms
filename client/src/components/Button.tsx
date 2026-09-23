import type { ButtonHTMLAttributes } from 'react'

// Refresh (design 3a/3b): buttons are sentence case, and their size follows importance.
//   primary — the ONE main action of a screen. Amber on web; near-black on mobile light and
//             amber on mobile dark (the `action` color role switches inside .mobile-app).
//   outline — every other real action.
//   ghost   — low-emphasis actions (toolbar "CSV", "Clear search").
//   danger  — an outline button with danger text (driver "No-show").
//   caution — caution-tinted fill for a fix-it action on a row (Payroll "Set rate").
type Variant = 'primary' | 'outline' | 'ghost' | 'danger' | 'caution'

// sm 32 = table-row / compact actions, md 38 = normal web buttons, lg 52 = mobile thumb actions
// and the few screens' one big action (Login/Register submit, driver Check in / Check out).
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-action text-on-action shadow-action hover:bg-action-hover',
  outline: 'border border-outline bg-outline-bg text-ink hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2',
  danger: 'border border-outline bg-outline-bg text-danger-ink hover:bg-alert-bg',
  caution: 'bg-caution-bg text-caution-fg hover:opacity-90',
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-8 rounded-row px-3 text-[12px] font-semibold',
  md: 'h-[38px] rounded-btn px-3.5 text-[13px] font-semibold',
  lg: 'h-[52px] rounded-m px-4 text-[15px] font-semibold',
}

export function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap transition-[background-color,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  )
}
