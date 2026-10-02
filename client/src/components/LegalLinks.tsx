import { Link } from 'react-router-dom'
import { LEGAL_DOCS } from '../lib/legal'

// "Privacy · Terms" links for footers (login page, app sidebars, My account). `className` sets
// the color for the surface it sits on.
export function LegalLinks({ className = 'text-muted' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-1.5 text-[12px] ${className}`}>
      <Link to={LEGAL_DOCS.privacy.path} className="hover:underline">
        Privacy
      </Link>
      <span aria-hidden>·</span>
      <Link to={LEGAL_DOCS.terms.path} className="hover:underline">
        Terms
      </Link>
    </span>
  )
}
