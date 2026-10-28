// Small pictures for the public website's text cards: simple flat icons drawn for SafeTurns (no
// outside source). Colors come from public.css (--ill-* variables), so they follow the light / dark
// theme. The big picture boxes use photos instead (public/site-photos, see CREDITS.md there).

const ICONS = {
  route: (
    <>
      <path d="M18 46 C18 30 46 34 46 18" stroke="var(--ill-navy)" strokeWidth="4" strokeDasharray="1 7" strokeLinecap="round" fill="none" />
      <circle cx="18" cy="46" r="6" fill="var(--ill-amber)" />
      <circle cx="46" cy="18" r="6" fill="var(--ill-navy)" />
    </>
  ),
  check: (
    <>
      <circle cx="32" cy="32" r="18" fill="var(--ill-amber)" />
      <path d="M23 32 L30 39 L42 26" stroke="var(--ill-navy)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  school: (
    <>
      <path d="M14 28 L32 16 L50 28 Z" fill="var(--ill-navy)" />
      <rect x="18" y="28" width="28" height="22" rx="3" fill="var(--ill-amber)" />
      <rect x="28" y="36" width="8" height="14" rx="4" fill="var(--ill-navy)" />
    </>
  ),
  profile: (
    <>
      <rect x="12" y="16" width="40" height="32" rx="6" fill="var(--ill-amber)" />
      <circle cx="24" cy="29" r="5" fill="var(--ill-navy)" />
      <path d="M17 41 Q24 33 31 41" fill="var(--ill-navy)" />
      <path d="M36 26 H46 M36 33 H46 M36 40 H42" stroke="var(--ill-navy)" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  bell: (
    <>
      <path d="M20 42 V30 Q20 18 32 18 Q44 18 44 30 V42 L48 46 H16 Z" fill="var(--ill-amber)" />
      <circle cx="32" cy="50" r="4" fill="var(--ill-navy)" />
    </>
  ),
  together: (
    <>
      <circle cx="22" cy="24" r="7" fill="var(--ill-navy)" />
      <circle cx="42" cy="24" r="7" fill="var(--ill-amber)" />
      <rect x="12" y="34" width="20" height="16" rx="8" fill="var(--ill-navy)" />
      <rect x="32" y="34" width="20" height="16" rx="8" fill="var(--ill-amber)" />
    </>
  ),
  shield: (
    <>
      <path d="M32 12 L48 18 V30 C48 40 41 48 32 52 C23 48 16 40 16 30 V18 Z" fill="var(--ill-navy)" />
      <path d="M26 32 L30 36 L38 27" stroke="var(--ill-amber)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  calm: (
    <>
      <path d="M14 38 Q23 30 32 38 T50 38" stroke="var(--ill-navy)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M14 48 Q23 40 32 48 T50 48" stroke="var(--ill-amber)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <circle cx="32" cy="20" r="7" fill="var(--ill-amber)" />
    </>
  ),
  clear: (
    <>
      <path d="M10 32 Q32 12 54 32 Q32 52 10 32 Z" fill="var(--ill-amber)" />
      <circle cx="32" cy="32" r="8" fill="var(--ill-navy)" />
    </>
  ),
  heart: <path d="M32 50 C14 38 12 24 20 18 C26 14 31 18 32 22 C33 18 38 14 44 18 C52 24 50 38 32 50 Z" fill="var(--ill-amber)" />,
  list: (
    <>
      <rect x="16" y="12" width="32" height="40" rx="5" fill="var(--ill-amber)" />
      {[24, 32, 40].map((ly) => (
        <g key={ly}>
          <circle cx="24" cy={ly} r="2.5" fill="var(--ill-navy)" />
          <path d={`M30 ${ly} H42`} stroke="var(--ill-navy)" strokeWidth="3" strokeLinecap="round" />
        </g>
      ))}
    </>
  ),
  calls: (
    <>
      <path d="M12 18 H40 Q44 18 44 22 V36 Q44 40 40 40 H24 L16 46 V40 H12 Q8 40 8 36 V22 Q8 18 12 18 Z" fill="var(--ill-navy)" />
      <path d="M30 28 H52 Q56 28 56 32 V44 Q56 48 52 48 H50 V54 L42 48 H30 Q26 48 26 44 V32 Q26 28 30 28 Z" fill="var(--ill-amber)" />
    </>
  ),
  status: (
    <>
      <rect x="20" y="10" width="24" height="44" rx="6" fill="var(--ill-navy)" />
      <rect x="24" y="16" width="16" height="30" rx="2" fill="var(--ill-amber)" />
      <path d="M28 31 L31 34 L36 28" stroke="var(--ill-navy)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
}

export type IconName = keyof typeof ICONS

export function CardIcon({ name }: { name: IconName }) {
  return (
    <svg className="site-card-icon" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <rect width="64" height="64" rx="20" fill="var(--ill-tile)" />
      {ICONS[name]}
    </svg>
  )
}
