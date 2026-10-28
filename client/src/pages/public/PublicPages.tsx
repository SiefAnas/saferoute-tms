import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { DemoRequest } from './DemoRequest'
import { CardIcon, Scene, type IconName } from './Illustrations'

// The public website's pages (look: public.css, pictures: Illustrations.tsx). Wording from the
// "SafeTurns Website" Claude Design project, minus anything the app doesn't do yet (live map, ETA:
// see V2_ROADMAP.md) and minus self sign-up.

type Item = { title: string; text: string; icon: IconName }

function Cards({ items, numbered }: { items: Item[]; numbered?: boolean }) {
  const List = numbered ? 'ol' : 'ul'
  return (
    <List className="site-cards">
      {items.map((i, n) => (
        <li key={i.title} className="site-card">
          <CardIcon name={i.icon} />
          {numbered && <span className="site-step">{String(n + 1).padStart(2, '0')}</span>}
          <div className="site-card-title">
            <span className="site-dot" />
            <h3>{i.title}</h3>
          </div>
          <p>{i.text}</p>
        </li>
      ))}
    </List>
  )
}

// Centred headline block that opens most pages.
function Hero({ eyebrow, title, lead, children }: { eyebrow?: string; title: string; lead?: string; children?: ReactNode }) {
  return (
    <section className="site-hero">
      {eyebrow && <p className="site-eyebrow site-rise">{eyebrow}</p>}
      <h1 className="site-rise site-rise-2">{title}</h1>
      {lead && <p className="site-lead site-rise site-rise-3">{lead}</p>}
      {children}
    </section>
  )
}

// Companies and Schools: a small Book a demo button (opens that page's demo form) and a Learn more
// link to the page itself. Parents: Contact us and Log in.
function AudienceButtons({ to }: { to: '/companies' | '/schools' }) {
  return (
    <div className="site-btn-row">
      <Link to={`${to}#demo`} className="site-btn site-btn-small">Book a demo</Link>
      <Link to={to} className="site-link">Learn more →</Link>
    </div>
  )
}

function ParentButtons({ small }: { small?: boolean }) {
  const size = small ? ' site-btn-small' : ''
  return (
    <div className="site-btn-row">
      <Link to="/contact" className={`site-btn${size}`}>Contact us</Link>
      <Link to="/login" className={`site-btn site-btn-outline${size}`}>Log in</Link>
    </div>
  )
}

const STEPS: Item[] = [
  { title: 'Plan the route.', text: 'Add riders, their needs, and their stops.', icon: 'route' },
  { title: 'Confirm every turn.', text: 'Drivers and monitors confirm each pickup and drop-off.', icon: 'check' },
  { title: 'Arrive calmly.', text: 'Schools confirm each arrival, and parents see it in the app.', icon: 'school' },
]

const FEATURES: Item[] = [
  { title: 'Rider profiles', text: 'Needs, contacts, and care notes.', icon: 'profile' },
  { title: 'Simple alerts', text: 'Pickup and drop-off updates, sent right away.', icon: 'bell' },
  { title: 'One place', text: 'Drivers, monitors, vans, routes, and schools, together.', icon: 'together' },
  { title: 'Secure by design', text: "Each child's details stay private.", icon: 'shield' },
]

const VALUES: Item[] = [
  { title: 'Calm', text: 'Simple tools that lower stress for everyone.', icon: 'calm' },
  { title: 'Clear', text: 'The right information, at the right time.', icon: 'clear' },
  { title: 'Caring', text: 'Every feature starts with the child.', icon: 'heart' },
]

export function HomePage() {
  return (
    <>
      <Hero
        eyebrow="Safer rides for special needs transportation"
        title="Every ride. Every child. Safely tracked."
        lead="SafeTurns helps transportation teams, schools, and families know where every child is, from pickup to drop-off."
      >
        <div className="site-btn-row">
          <Link to="/contact" className="site-btn">Contact us</Link>
          <Link to="/about" className="site-btn site-btn-outline">Learn more</Link>
        </div>
      </Hero>
      <section className="site-wide">
        <Scene size="hero" name="boarding" label="A child boarding an accessible van with a caring driver" />
      </section>

      <section className="site-section">
        <h2>One calm app for everyone who cares about the ride.</h2>
        <ul className="site-cards">
          <li className="site-card site-audience">
            <Scene size="card" name="driverVan" label="A driver beside a van" />
            <h3>Companies</h3>
            <p>Plan routes and guide drivers with ease.</p>
            <AudienceButtons to="/companies" />
          </li>
          <li className="site-card site-audience">
            <Scene size="card" name="schoolArrival" label="Students arriving at a school entrance" />
            <h3>Schools</h3>
            <p>Know who is coming and when.</p>
            <AudienceButtons to="/schools" />
          </li>
          <li className="site-card site-audience">
            <Scene size="card" name="parentChildHome" label="A parent and child at home" />
            <h3>Parents</h3>
            <p>Follow your child's ride.</p>
            <ParentButtons small />
          </li>
        </ul>
      </section>

      <section className="site-section">
        <h2>How it works</h2>
        <p>Three simple steps.</p>
        <Cards items={STEPS} numbered />
      </section>

      <section className="site-section">
        <h2>Calm for drivers. Clear for schools. Comforting for parents.</h2>
        <Cards items={FEATURES} />
      </section>
    </>
  )
}

export function AboutPage() {
  return (
    <>
      <Hero
        eyebrow="About us"
        title="We help move the kids who need the most care."
        lead="SafeTurns was built with drivers, schools, and parents. We make special needs transportation simple to run and easy to trust."
      />
      <section className="site-wide">
        <Scene size="hero" name="team" label="The SafeTurns team with drivers and a van" />
      </section>
      <section className="site-section">
        <h2>Our story is simple.</h2>
        <p>Every day, thousands of children ride to school with special care needs. Their families want to know they are safe.</p>
        <p>Transportation teams work hard to make that happen. We give them one clear tool to plan, run, and share every ride.</p>
      </section>
      <section className="site-section">
        <h2>What we value</h2>
        <Cards items={VALUES} />
      </section>
    </>
  )
}

// Opens with the picture, then the headline, then Companies and Schools beside their pictures.
export function MissionPage() {
  return (
    <>
      <section className="site-wide">
        <Scene size="hero" name="hug" label="A parent hugging their special needs child" />
      </section>
      <Hero
        eyebrow="Our mission"
        title="Every child home safe. Every day."
        lead="We help the people behind each ride work together, so families can let go of the worry."
      />
      <section className="site-split">
        <Scene size="split" name="wheelchair" label="A driver helping a child in a wheelchair up the van ramp" />
        <div className="site-split-text">
          <p className="site-kicker">For companies</p>
          <h2>Every route, under control.</h2>
          <p>See every van and every rider in one place. Drivers know each child's needs before they arrive.</p>
          <AudienceButtons to="/companies" />
        </div>
      </section>
      <section className="site-split">
        <Scene size="split" name="teacherWelcome" label="A teacher welcoming a student at the school door" />
        <div className="site-split-text">
          <p className="site-kicker">For schools</p>
          <h2>Every student, accounted for.</h2>
          <p>Know who is on board and confirm each pickup and drop-off. Staff are ready at the door for every student.</p>
          <AudienceButtons to="/schools" />
        </div>
      </section>
    </>
  )
}

export function PublicCompaniesPage() {
  return (
    <>
      <Hero
        eyebrow="For companies"
        title="Run every route with confidence."
        lead="Plan routes, guide drivers, and keep families informed. All in one place."
      >
        <DemoRequest audience="company" />
      </Hero>
      <section className="site-wide">
        <Scene size="hero" name="fleet" label="A fleet of accessible vans and a driver" />
      </section>
      <section className="site-section">
        <h2>Less stress for your team.</h2>
        <Cards
          items={[
            { title: 'Rider needs', text: 'Wheelchair, medical, and care notes, ready for each driver.', icon: 'profile' },
            { title: 'Every assignment', text: 'Drivers, monitors, vans, and students, matched in one place.', icon: 'together' },
            { title: 'Fewer calls', text: 'Schools and parents see updates on their own.', icon: 'calls' },
          ]}
        />
      </section>
    </>
  )
}

export function PublicSchoolsPage() {
  return (
    <>
      <Hero
        eyebrow="For schools"
        title="Know every student is on the way."
        lead="See who is on board and confirm each pickup and drop-off. Be ready at the door."
      >
        <DemoRequest audience="school" />
      </Hero>
      <section className="site-wide">
        <Scene size="hero" name="staffGreeting" label="School staff greeting students at drop-off" />
      </section>
      <section className="site-section">
        <h2>Clear, from the front office.</h2>
        <Cards
          items={[
            { title: 'Who is on board', text: 'A simple list of every rider, checked in.', icon: 'list' },
            { title: 'Pickup and drop-off', text: 'Confirm each student in a tap.', icon: 'check' },
            { title: 'One place', text: 'Every route and every contact, together.', icon: 'school' },
          ]}
        />
      </section>
    </>
  )
}

// No self sign-up: parent accounts come from the child's transport company or school.
export function PublicParentsPage() {
  return (
    <>
      <Hero eyebrow="For parents" title="Follow your child's ride." lead="Know when they are picked up and when they arrive.">
        <p className="site-note site-rise site-rise-3">Your account is set up by your child's transport company or school.</p>
        <ParentButtons />
      </Hero>
      <section className="site-wide">
        <Scene size="hero" name="parentPhone" label="A parent checking a phone as their child waves from the van" />
      </section>
      <section className="site-section">
        <h2>Peace of mind, in your pocket.</h2>
        <Cards
          items={[
            { title: 'Ride status', text: 'Picked up, arrived at school, dropped off.', icon: 'status' },
            { title: 'Gentle alerts', text: 'A quick note at pickup and drop-off.', icon: 'bell' },
            { title: 'Your child, known', text: 'The driver sees the needs and care notes on file.', icon: 'heart' },
          ]}
        />
      </section>
    </>
  )
}
