import type { ReactNode } from 'react'
import { Copyright } from '../../components/Copyright'
import { Logo } from '../../components/Logo'
import { LegalLinks } from '../../components/LegalLinks'

// The signed-out card (slate background, centered surface card, SafeTurns logo) shared by login,
// forgot password, reset password and the first-login "set your password" screen. The card flips
// with the theme, so the logo uses surface "auto". When the title is just the product name (the
// login page) the logo already says it, so the heading stays for screen readers only.
export function AuthScreen({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-2 overflow-hidden bg-sidebar p-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-20">
        <div className="absolute top-[-10%] left-[-10%] h-[40%] w-[40%] rounded-full bg-primary-container blur-[120px]" />
        <div className="absolute right-[-10%] bottom-[-10%] h-[30%] w-[30%] rounded-full bg-secondary-container blur-[100px]" />
      </div>

      <div className="relative z-10 flex w-full max-w-[440px] flex-col items-center gap-8 rounded-xl bg-surface p-8 shadow-drawer">
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo kind="lockup" surface="auto" className="mb-2 h-10" />
          <h1 className={title === 'SafeTurns' ? 'sr-only' : 'text-headline-md tracking-tight text-primary'}>{title}</h1>
          <p className="text-label-md text-muted">{subtitle}</p>
        </div>
        {children}
      </div>
      <LegalLinks className="relative z-10 pt-2 text-sidebar-icon" />
      <Copyright className="relative z-10 !pt-1 !text-sidebar-icon" />
    </main>
  )
}
