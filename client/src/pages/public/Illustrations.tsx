// Pictures for the public website: simple flat illustrations drawn for SafeTurns (no outside
// source, no photos of real people; figures are faceless). Colors come from public.css
// (--ill-* variables), so every scene follows the light / dark theme.
//
// Scenes are 480 x 320. Icons (for the text cards) are 64 x 64.

import type { ReactNode } from 'react'

const SKINS = ['var(--ill-skin-1)', 'var(--ill-skin-2)', 'var(--ill-skin-3)']

type PersonProps = {
  x: number
  y: number // where the feet touch the ground
  s?: number // scale: 1 = adult, about 0.62 = child
  skin?: number
  shirt?: string
  hair?: string
  wave?: boolean // right arm raised
  reach?: boolean // both arms forward (hugging, helping)
  bag?: boolean // school backpack
}

// A faceless standing figure.
function Person({ x, y, s = 1, skin = 0, shirt = 'var(--ill-navy)', hair = 'var(--ill-hair)', wave, reach, bag }: PersonProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {bag && <rect x="-24" y="-84" width="16" height="30" rx="6" fill="var(--ill-amber)" />}
      <rect x="-13" y="-46" width="11" height="46" rx="5.5" fill="var(--ill-legs)" />
      <rect x="2" y="-46" width="11" height="46" rx="5.5" fill="var(--ill-legs)" />
      <rect x="-20" y="-98" width="40" height="58" rx="18" fill={shirt} />
      {reach ? (
        <path d="M-16 -86 Q8 -78 30 -66 M16 -86 Q30 -78 40 -70" stroke={shirt} strokeWidth="11" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M-17 -86 Q-26 -66 -24 -48" stroke={shirt} strokeWidth="11" strokeLinecap="round" fill="none" />
      )}
      {wave ? (
        <path d="M17 -86 Q30 -104 28 -124" stroke={shirt} strokeWidth="11" strokeLinecap="round" fill="none" />
      ) : (
        !reach && <path d="M17 -86 Q26 -66 24 -48" stroke={shirt} strokeWidth="11" strokeLinecap="round" fill="none" />
      )}
      <circle cx="0" cy="-118" r="17" fill={SKINS[skin % SKINS.length]} />
      <path d="M-17 -120 A17 17 0 0 1 17 -120 Q8 -130 -17 -120 Z" fill={hair} />
    </g>
  )
}

// A minibus seen from the side. door = open side door; ramp = wheelchair ramp at the back.
function Van({ x, y, s = 1, door, ramp, window: win }: { x: number; y: number; s?: number; door?: boolean; ramp?: boolean; window?: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {ramp && <path d="M232 -24 L292 0 L232 0 Z" fill="var(--ill-line)" />}
      <path d="M0 -24 V-96 Q0 -112 16 -112 H184 Q200 -112 214 -96 L234 -64 V-24 Q234 -12 222 -12 H12 Q0 -12 0 -24 Z" fill="var(--ill-van)" />
      <rect x="0" y="-52" width="234" height="10" fill="var(--ill-amber)" />
      <rect x="18" y="-98" width="44" height="32" rx="6" fill="var(--ill-glass)" />
      <rect x="72" y="-98" width="44" height="32" rx="6" fill="var(--ill-glass)" />
      {win}
      <rect x="126" y="-98" width="44" height="32" rx="6" fill={door ? 'var(--ill-door)' : 'var(--ill-glass)'} />
      {door && <rect x="126" y="-98" width="44" height="74" rx="4" fill="var(--ill-door)" />}
      <path d="M180 -98 H196 Q204 -98 210 -88 L222 -66 H180 Z" fill="var(--ill-glass)" />
      <circle cx="52" cy="-12" r="20" fill="var(--ill-wheel)" />
      <circle cx="52" cy="-12" r="8" fill="var(--ill-hub)" />
      <circle cx="186" cy="-12" r="20" fill="var(--ill-wheel)" />
      <circle cx="186" cy="-12" r="8" fill="var(--ill-hub)" />
    </g>
  )
}

function Wheelchair({ x, y, s = 1, children }: { x: number; y: number; s?: number; children?: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {children}
      <circle cx="0" cy="-26" r="26" fill="none" stroke="var(--ill-chair)" strokeWidth="6" />
      <circle cx="38" cy="-8" r="8" fill="var(--ill-chair)" />
      <path d="M-14 -60 V-34 H34 L40 -14 M-14 -60 L-22 -74" stroke="var(--ill-chair)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </g>
  )
}

function School({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="0" y="-150" width="220" height="150" rx="6" fill="var(--ill-building)" />
      <path d="M-10 -150 L110 -200 L230 -150 Z" fill="var(--ill-roof)" />
      <path d="M110 -200 V-236" stroke="var(--ill-navy)" strokeWidth="4" />
      <path d="M110 -236 H140 L134 -228 L140 -220 H110 Z" fill="var(--ill-amber)" />
      {[18, 62, 136, 180].map((wx) => (
        <rect key={wx} x={wx} y="-128" width="26" height="30" rx="4" fill="var(--ill-glass)" />
      ))}
      <rect x="82" y="-74" width="56" height="74" rx="28" fill="var(--ill-door)" />
      <path d="M110 -74 V0" stroke="var(--ill-building)" strokeWidth="3" />
    </g>
  )
}

function Heart({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 8 C-14 -2 -16 -14 -8 -18 C-3 -20 0 -16 0 -13 C0 -16 3 -20 8 -18 C16 -14 14 -2 0 8 Z" fill="var(--ill-amber)" />
}

function Tree({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-5" y="-40" width="10" height="40" rx="4" fill="var(--ill-trunk)" />
      <circle cx="0" cy="-58" r="28" fill="var(--ill-leaf)" />
    </g>
  )
}

// Sky, sun and ground every outdoor scene sits on.
function Outdoors({ children }: { children: ReactNode }) {
  return (
    <>
      <rect width="480" height="320" fill="var(--ill-sky)" />
      <circle cx="404" cy="62" r="26" fill="var(--ill-sun)" />
      <rect y="268" width="480" height="52" fill="var(--ill-ground)" />
      {children}
    </>
  )
}

function Indoors({ children }: { children: ReactNode }) {
  return (
    <>
      <rect width="480" height="320" fill="var(--ill-wall)" />
      <rect x="300" y="44" width="120" height="96" rx="10" fill="var(--ill-glass)" />
      <path d="M360 44 V140 M300 92 H420" stroke="var(--ill-wall)" strokeWidth="6" />
      <rect y="268" width="480" height="52" fill="var(--ill-floor)" />
      {children}
    </>
  )
}

const SCENES = {
  boarding: (
    <Outdoors>
      <Tree x={60} y={268} s={1.1} />
      <Van x={170} y={268} door />
      <Person x={130} y={268} skin={0} shirt="var(--ill-navy)" reach />
      <Person x={318} y={250} s={0.62} skin={2} shirt="var(--ill-amber)" bag />
    </Outdoors>
  ),
  driverVan: (
    <Outdoors>
      <Tree x={420} y={268} />
      <Van x={140} y={268} />
      <Person x={92} y={268} skin={1} shirt="var(--ill-navy)" wave />
    </Outdoors>
  ),
  schoolArrival: (
    <Outdoors>
      <School x={40} y={268} s={0.95} />
      <Van x={286} y={268} s={0.72} />
      <Person x={262} y={268} s={0.62} skin={0} shirt="var(--ill-amber)" bag />
      <Person x={236} y={268} s={0.6} skin={2} shirt="var(--ill-teal)" bag />
    </Outdoors>
  ),
  parentChildHome: (
    <Indoors>
      <rect x="60" y="196" width="230" height="56" rx="20" fill="var(--ill-sofa)" />
      <rect x="48" y="170" width="34" height="98" rx="16" fill="var(--ill-sofa)" />
      <rect x="268" y="170" width="34" height="98" rx="16" fill="var(--ill-sofa)" />
      <Person x={140} y={240} skin={1} shirt="var(--ill-navy)" />
      <Person x={204} y={240} s={0.62} skin={1} shirt="var(--ill-amber)" />
      <Heart x={176} y={92} s={1.6} />
      <rect x="360" y="200" width="16" height="68" rx="6" fill="var(--ill-trunk)" />
      <circle cx="368" cy="192" r="22" fill="var(--ill-leaf)" />
    </Indoors>
  ),
  hug: (
    <Outdoors>
      <Tree x={70} y={268} s={1.3} />
      <Tree x={420} y={268} s={0.9} />
      <Person x={218} y={268} skin={2} shirt="var(--ill-navy)" reach />
      <Person x={262} y={268} s={0.64} skin={2} shirt="var(--ill-amber)" reach />
      <Heart x={240} y={84} s={2} />
    </Outdoors>
  ),
  wheelchair: (
    <Outdoors>
      <Van x={40} y={268} ramp />
      <Wheelchair x={372} y={268}>
        <Person x={8} y={-30} s={0.6} skin={0} shirt="var(--ill-amber)" />
      </Wheelchair>
      <Person x={430} y={268} skin={1} shirt="var(--ill-navy)" reach />
    </Outdoors>
  ),
  teacherWelcome: (
    <Outdoors>
      <School x={130} y={268} s={1.05} />
      <Person x={88} y={268} skin={2} shirt="var(--ill-teal)" wave />
      <Person x={44} y={268} s={0.62} skin={0} shirt="var(--ill-amber)" bag />
    </Outdoors>
  ),
  team: (
    <Outdoors>
      <Van x={210} y={250} s={1.05} />
      <Person x={70} y={276} skin={0} shirt="var(--ill-navy)" />
      <Person x={130} y={276} skin={1} shirt="var(--ill-teal)" />
      <Person x={190} y={276} skin={2} shirt="var(--ill-amber)" wave />
      <Person x={250} y={276} skin={1} shirt="var(--ill-navy)" />
    </Outdoors>
  ),
  fleet: (
    <Outdoors>
      <Van x={16} y={268} s={0.62} />
      <Van x={176} y={268} s={0.62} />
      <Van x={336} y={268} s={0.56} />
      <Person x={322} y={268} skin={2} shirt="var(--ill-navy)" wave />
    </Outdoors>
  ),
  staffGreeting: (
    <Outdoors>
      <School x={20} y={268} s={0.95} />
      <Person x={262} y={268} skin={1} shirt="var(--ill-teal)" wave />
      <Person x={314} y={268} skin={0} shirt="var(--ill-navy)" />
      <Person x={372} y={268} s={0.62} skin={2} shirt="var(--ill-amber)" bag />
      <Person x={414} y={268} s={0.6} skin={1} shirt="var(--ill-coral)" bag />
    </Outdoors>
  ),
  parentPhone: (
    <Outdoors>
      <Van
        x={200}
        y={268}
        window={
          <g>
            <circle cx="94" cy="-80" r="10" fill="var(--ill-skin-3)" />
            <path d="M104 -80 Q112 -92 110 -100" stroke="var(--ill-amber)" strokeWidth="6" strokeLinecap="round" fill="none" />
          </g>
        }
      />
      <Person x={110} y={268} skin={0} shirt="var(--ill-navy)" reach />
      <rect x="134" y="168" width="22" height="38" rx="5" fill="var(--ill-ink)" />
      <rect x="138" y="173" width="14" height="24" rx="2" fill="var(--ill-amber)" />
    </Outdoors>
  ),
  contact: (
    <Indoors>
      <rect x="70" y="120" width="190" height="124" rx="14" fill="var(--ill-paper)" />
      <path d="M70 134 L165 196 L260 134" stroke="var(--ill-navy)" strokeWidth="6" strokeLinejoin="round" fill="none" />
      <path d="M268 72 H380 Q396 72 396 88 V140 Q396 156 380 156 H312 L290 176 L294 156 H268 Q252 156 252 140 V88 Q252 72 268 72 Z" fill="var(--ill-amber)" />
      <circle cx="296" cy="114" r="7" fill="var(--ill-navy)" />
      <circle cx="324" cy="114" r="7" fill="var(--ill-navy)" />
      <circle cx="352" cy="114" r="7" fill="var(--ill-navy)" />
    </Indoors>
  ),
}

export type SceneName = keyof typeof SCENES

export function Scene({ name, label, size }: { name: SceneName; label: string; size: 'hero' | 'split' | 'card' }) {
  return (
    <div className={`site-picture site-picture-${size}`}>
      <svg viewBox="0 0 480 320" preserveAspectRatio={size === 'split' ? 'xMidYMax meet' : 'xMidYMax slice'} role="img" aria-label={label}>
        {SCENES[name]}
      </svg>
    </div>
  )
}

// Small pictures for the text cards (64 x 64, amber on a soft round tile).
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
