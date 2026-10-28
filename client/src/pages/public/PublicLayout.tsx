import { Link, Outlet, useLocation } from 'react-router-dom'

// Shell for the public website at the site root (/, /about, /mission, ...). Plain links only:
// no design has been chosen for these pages yet.
export function PublicLayout() {
  const { pathname } = useLocation()
  return (
    <>
      <header>
        <nav aria-label="Main">
          <ul>
            <li><Link to="/">Home</Link></li>
            <li><Link to="/about">About us</Link></li>
            <li><Link to="/mission">Mission</Link></li>
            <li><Link to="/companies">Companies</Link></li>
            <li><Link to="/schools">Schools</Link></li>
            <li><Link to="/parents">Parents</Link></li>
            <li><Link to="/contact">Contact us</Link></li>
            <li><Link to="/login">Log in</Link></li>
          </ul>
        </nav>
      </header>
      <main>
        <Outlet />
        {pathname !== '/contact' && (
          <section>
            <h2>Ready for calmer, safer rides?</h2>
            <Link to="/contact">Contact us</Link> <Link to="/login">Log in</Link>
          </section>
        )}
      </main>
      <footer>
        <Link to="/terms">Terms of Use</Link> <Link to="/privacy">Privacy Policy</Link>
      </footer>
    </>
  )
}
