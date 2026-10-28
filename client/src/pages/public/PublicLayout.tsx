import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import './public.css'

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/about', label: 'About us' },
  { to: '/mission', label: 'Mission' },
  { to: '/companies', label: 'Companies' },
  { to: '/schools', label: 'Schools' },
  { to: '/parents', label: 'Parents' },
  { to: '/contact', label: 'Contact us' },
]

// The public site's own light / dark choice: light unless the visitor switched. Kept apart from the
// signed-in app's theme (lib/theme.ts), so switching here never changes the app.
type SiteTheme = 'light' | 'dark'
const SITE_THEME_KEY = 'safeturns-site-theme'

function readSiteTheme(): SiteTheme {
  try {
    return localStorage.getItem(SITE_THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

// The shield-with-a-turn-arrow mark from the design.
function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 2.5 L27.5 6.5 V15 C27.5 22.3 22.6 27.6 16 29.5 C9.4 27.6 4.5 22.3 4.5 15 V6.5 Z" fill="var(--ink)" />
      <path d="M11.5 21.5 V16 C11.5 13.8 13 12.5 15.2 12.5 H20.5" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 9.5 L21 12.5 L18 15.5" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Logo() {
  return (
    <Link to="/" className="site-logo" aria-label="SafeTurns home">
      <Mark />
      <span>SafeTurns</span>
    </Link>
  )
}

// Shell for the public website at the site root (public.css). Log in goes to the existing /login page.
export function PublicLayout() {
  const { pathname, hash } = useLocation()
  const [headerHidden, setHeaderHidden] = useState(false)
  const [theme, setTheme] = useState<SiteTheme>(readSiteTheme)
  const lastY = useRef(0)

  // A new page starts at the top with the top menu showing (#demo links scroll themselves).
  useEffect(() => {
    setHeaderHidden(false)
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])

  // Scrolling down hides the top menu; scrolling up brings it back.
  useEffect(() => {
    function onScroll() {
      const y = window.scrollY
      if (Math.abs(y - lastY.current) < 6) return
      setHeaderHidden(y > lastY.current && y > 80)
      lastY.current = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem(SITE_THEME_KEY, next)
    } catch {
      // Not saved (private window): the switch still works for this visit.
    }
  }

  return (
    <div className="site" data-site-theme={theme}>
      <header className="site-header" data-hidden={headerHidden}>
        <div className="site-header-inner">
          <Logo />
          {/* One row of links: centred on a computer, a sideways-scrolling row under the logo on a phone. */}
          <nav className="site-nav" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="site-header-actions">
            <button
              type="button"
              className="site-round"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={toggleTheme}
            >
              <span className="site-theme-dot" />
            </button>
            <Link to="/login" className="site-btn site-btn-small">
              Log in
            </Link>
          </div>
        </div>
      </header>

      <main>
        <Outlet />
        {pathname !== '/contact' && (
          <div className="site-cta-wrap">
            <section className="site-cta">
              <h2>Ready for calmer, safer rides?</h2>
              <div className="site-btn-row">
                <Link to="/contact" className="site-btn">Contact us</Link>
                <Link to="/login" className="site-btn site-btn-outline">Log in</Link>
              </div>
            </section>
          </div>
        )}
      </main>
      <footer className="site-footer">
        <div className="site-footer-brand">
          <div className="site-logo">
            <Mark />
            <span>SafeTurns</span>
          </div>
          <p>Every ride. Every child. Safely tracked.</p>
        </div>
        <nav aria-label="Footer">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to}>{n.label}</Link>
          ))}
          <Link to="/login">Log in</Link>
          <Link to="/terms">Terms of Use</Link>
          <Link to="/privacy">Privacy Policy</Link>
        </nav>
      </footer>
    </div>
  )
}
