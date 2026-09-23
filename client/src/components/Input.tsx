import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

// Refresh form fields: 40px, 8px radius, outline border, amber focus ring.
export const FIELD_CLASS =
  'h-10 w-full rounded-row border border-outline bg-surface px-3 text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-amber focus:ring-2 focus:ring-amber/20'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD_CLASS} ${className}`} {...props} />
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${FIELD_CLASS} ${className}`} {...props} />
}

// 12px/600 label above a field.
export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[12px] font-semibold text-muted">{label}</span>
      {children}
    </label>
  )
}
