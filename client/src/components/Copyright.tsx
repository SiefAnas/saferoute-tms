// The copyright line at the bottom of every page (each layout's scroll area, and the signed-out
// pages). One place for the wording.
export const COPYRIGHT = '© 2026 Anas Sief. All rights reserved.'

export function Copyright({ className = '' }: { className?: string }) {
  return <p className={`py-4 text-center text-[12px] text-muted ${className}`}>{COPYRIGHT}</p>
}
