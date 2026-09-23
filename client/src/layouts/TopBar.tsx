import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// The admin shell's 64px top bar belongs to AdminLayout, but its title and actions belong to
// the page. AdminLayout exposes the bar's two slots through this context and each page fills
// them with <PageTopBar>, which portals its content up. A page that doesn't render one shows
// its nav label as the title.
export interface TopBarSlots {
  title: HTMLElement | null
  actions: HTMLElement | null
}

export const TopBarContext = createContext<TopBarSlots>({ title: null, actions: null })

export function PageTopBar({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  const slots = useContext(TopBarContext)
  return (
    <>
      {slots.title &&
        createPortal(
          <div data-page-title className="flex min-w-0 flex-col">
            <h1 className="truncate text-page-title text-ink">{title}</h1>
            {subtitle && <span className="truncate text-[13px] text-muted">{subtitle}</span>}
          </div>,
          slots.title,
        )}
      {slots.actions && children && createPortal(children, slots.actions)}
    </>
  )
}
