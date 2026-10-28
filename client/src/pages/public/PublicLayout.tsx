import { useEffect, useState } from 'react'
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

// Shell for the public website at the site root (public.css). Log in goes to the existing /login page.
export function PublicLayout() {
  const { pathname, hash } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  // A new page starts at the top with the phone menu closed (#demo links scroll themselves).
  useEffect(() => {
    setMenuOpen(false)
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])

  return (
    <div className="site">
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="site-logo" aria-label="SafeTurns home">
            <Mark />
            <span>SafeTurns</span>
          </Link>
          <nav className="site-nav" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="site-header-actions">
            <Link to="/login" className="site-btn site-btn-small">
              Log in
            </Link>
            <button
              type="button"
              className="site-menu-button"
              aria-label="Menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>
      {menuOpen && (
        <nav className="site-mobile-menu" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end>
              {n.label}
            </NavLink>
          ))}
          <Link to="/login">Log in</Link>
        </nav>
      )}
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
        <div className="site-logo">
          <Mark />
          <span>SafeTurns</span>
        </div>
        <nav aria-label="Footer">
          <Link to="/contact">Contact us</Link>
          <Link to="/terms">Terms of Use</Link>
          <Link to="/privacy">Privacy Policy</Link>
        </nav>
      </footer>
    </div>
  )
}
