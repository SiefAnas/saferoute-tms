import { Link } from 'react-router-dom'
import { DemoRequest } from './DemoRequest'

// The public website's pages (look: public.css). Wording from the "SafeTurns Website" Claude Design
// project, minus anything the app doesn't do yet (live map, ETA: see V2_ROADMAP.md) and minus self
// sign-up. Photos are placeholders until real ones are chosen; each names the photo it is for.

type Item = { title: string; text: string }

function Photo({ label, size }: { label: string; size: 'hero' | 'split' | 'card' }) {
  return (
    <div className={`site-photo site-photo-${size}`} role="img" aria-label={`Photo placeholder: ${label}`}>
      Photo: {label}
    </div>
  )
}

function Cards({ items }: { items: Item[] }) {
  return (
    <ul className="site-cards">
      {items.map((i) => (
        <li key={i.title} className="site-card">
          <span className="site-dot" />
          <h3>{i.title}</h3>
          <p>{i.text}</p>
        </li>
      ))}
    </ul>
  )
}

// Centred headline block that opens most pages.
function Hero({ eyebrow, title, lead, children }: { eyebrow?: string; title: string; lead?: string; children?: React.ReactNode }) {
  return (
    <section className="site-hero">
      {eyebrow && <p className="site-eyebrow site-rise">{eyebrow}</p>}
      <h1 className="site-rise site-rise-2">{title}</h1>
      {lead && <p className="site-lead site-rise site-rise-3">{lead}</p>}
      {children}
    </section>
  )
}

// Companies and Schools buttons open the demo form; Parents get Contact us and Log in.
function DemoButton({ to }: { to: '/companies' | '/schools' }) {
  return (
    <Link to={`${to}#demo`} className="site-btn">
      Book a demo
    </Link>
  )
}

function ParentButtons() {
  return (
    <>
      <Link to="/contact" className="site-btn">Contact us</Link>
      <Link to="/login" className="site-btn site-btn-outline">Log in</Link>
    </>
  )
}

const STEPS: Item[] = [
  { title: 'Plan the route.', text: 'Add riders, their needs, and their stops.' },
  { title: 'Confirm every turn.', text: 'Drivers and monitors confirm each pickup and drop-off.' },
  { title: 'Arrive calmly.', text: 'Schools confirm each arrival, and parents see it in the app.' },
]

const FEATURES: Item[] = [
  { title: 'Rider profiles', text: 'Needs, contacts, and care notes.' },
  { title: 'Simple alerts', text: 'Pickup and drop-off updates, sent right away.' },
  { title: 'One place', text: 'Drivers, monitors, vans, routes, and schools, together.' },
  { title: 'Secure by design', text: "Each child's details stay private." },
]

const VALUES: Item[] = [
  { title: 'Calm', text: 'Simple tools that lower stress for everyone.' },
  { title: 'Clear', text: 'The right information, at the right time.' },
  { title: 'Caring', text: 'Every feature starts with the child.' },
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
        <Photo size="hero" label="child boarding an accessible van with a caring driver" />
      </section>

      <section className="site-section">
        <h2>One calm app for everyone who cares about the ride.</h2>
        <ul className="site-cards">
          <li className="site-card site-audience">
            <Photo size="card" label="driver and van" />
            <h3>Companies</h3>
            <p>Plan routes and guide drivers with ease.</p>
            <div className="site-btn-row"><DemoButton to="/companies" /></div>
          </li>
          <li className="site-card site-audience">
            <Photo size="card" label="school entrance at arrival" />
            <h3>Schools</h3>
            <p>Know who is coming and when.</p>
            <div className="site-btn-row"><DemoButton to="/schools" /></div>
          </li>
          <li className="site-card site-audience">
            <Photo size="card" label="parent and child at home" />
            <h3>Parents</h3>
            <p>Follow your child's ride.</p>
            <div className="site-btn-row"><ParentButtons /></div>
          </li>
        </ul>
      </section>

      <section className="site-section">
        <h2>How it works</h2>
        <p>Three simple steps.</p>
        <ol className="site-cards">
          {STEPS.map((s, i) => (
            <li key={s.title} className="site-card">
              <span className="site-step">{String(i + 1).padStart(2, '0')}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
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
        <Photo size="hero" label="SafeTurns team with drivers" />
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

// Opens with the photo, then the headline, then Companies and Schools beside their pictures.
export function MissionPage() {
  return (
    <>
      <section className="site-wide">
        <Photo size="hero" label="parent hugging their special needs child" />
      </section>
      <Hero
        eyebrow="Our mission"
        title="Every child home safe. Every day."
        lead="We help the people behind each ride work together, so families can let go of the worry."
      />
      <section className="site-split">
        <Photo size="split" label="driver securing a wheelchair" />
        <div className="site-split-text">
          <p className="site-kicker">For companies</p>
          <h2>Every route, under control.</h2>
          <p>See every van and every rider in one place. Drivers know each child's needs before they arrive.</p>
          <DemoButton to="/companies" />
        </div>
      </section>
      <section className="site-split">
        <Photo size="split" label="teacher welcoming a student at arrival" />
        <div className="site-split-text">
          <p className="site-kicker">For schools</p>
          <h2>Every student, accounted for.</h2>
          <p>Know who is on board and confirm each pickup and drop-off. Staff are ready at the door for every student.</p>
          <DemoButton to="/schools" />
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
        <Photo size="hero" label="accessible van fleet and driver" />
      </section>
      <section className="site-section">
        <h2>Less stress for your team.</h2>
        <Cards
          items={[
            { title: 'Rider needs', text: 'Wheelchair, medical, and care notes, ready for each driver.' },
            { title: 'Every assignment', text: 'Drivers, monitors, vans, and students, matched in one place.' },
            { title: 'Fewer calls', text: 'Schools and parents see updates on their own.' },
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
        <Photo size="hero" label="staff greeting students at drop-off" />
      </section>
      <section className="site-section">
        <h2>Clear, from the front office.</h2>
        <Cards
          items={[
            { title: 'Who is on board', text: 'A simple list of every rider, checked in.' },
            { title: 'Pickup and drop-off', text: 'Confirm each student in a tap.' },
            { title: 'One place', text: 'Every route and every contact, together.' },
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
        <div className="site-btn-row">
          <ParentButtons />
        </div>
      </Hero>
      <section className="site-wide">
        <Photo size="hero" label="parent checking phone as child waves from van" />
      </section>
      <section className="site-section">
        <h2>Peace of mind, in your pocket.</h2>
        <Cards
          items={[
            { title: 'Ride status', text: 'Picked up, arrived at school, dropped off.' },
            { title: 'Gentle alerts', text: 'A quick note at pickup and drop-off.' },
            { title: 'Your child, known', text: 'The driver sees the needs and care notes on file.' },
          ]}
        />
      </section>
    </>
  )
}
