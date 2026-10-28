import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { DemoRequest } from './DemoRequest'
import { CardIcon, Scene, type IconName } from './Illustrations'

// The public website's pages (look: public.css, pictures: Illustrations.tsx). Wording from the
// "SafeTurns Website" Claude Design project, minus anything the app doesn't do yet (live map, ETA:
// see V2_ROADMAP.md) and minus self sign-up.

type Item = { title: string; text?: string; icon: IconName }

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
          {i.text && <p>{i.text}</p>}
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
        lead="SafeTurns helps special needs transportation teams run their routes, drivers, and students in one place."
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
            <p>Run your fleet with less stress.</p>
            <AudienceButtons to="/companies" />
          </li>
          <li className="site-card site-audience">
            <Scene size="card" name="schoolArrival" label="Students arriving at a school entrance" />
            <h3>Schools</h3>
            <p>Know when every student is on board and where they are.</p>
            <AudienceButtons to="/schools" />
          </li>
          <li className="site-card site-audience">
            <Scene size="card" name="parentChildHome" label="A parent and child at home" />
            <h3>Parents</h3>
            <p>Know your child is safe on the way to school.</p>
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
        title="Built by someone who has been in the van"
      />
      <section className="site-wide">
        <Scene size="hero" name="team" label="The SafeTurns team with drivers and a van" />
      </section>
      <section className="site-section">
        <p>
          Anas Sief, the founder, started in special needs transportation as a monitor. Soon after, I also worked as a 7D
          driver and as an assistant team manager, all at the same time. Every day, I saw how much care these children need,
          and how much pressure the teams carry to get everyone safely to school.
        </p>
        <p>
          I am a Computer Science and IT graduate from Northeastern University. I took what I learned in the field and in the
          classroom, and I started building SafeTurns. My goal is simple: make special needs transportation calmer, clearer,
          and safer for everyone involved.
        </p>
        <p>
          I have spent more hours in a van than most developers spend in an office, so I know exactly where the pain points
          are. Our code is better for it.
        </p>
        <h2 className="site-closing-line">We are small, we are careful, and we are just getting started.</h2>
      </section>
      <section className="site-section">
        <h2>What we value</h2>
        <Cards items={VALUES} />
      </section>
    </>
  )
}

// Opens with the picture, then the headline, then Parents, Companies and Schools beside their pictures.
export function MissionPage() {
  return (
    <>
      <section className="site-wide">
        <Scene size="hero" name="hug" label="A parent hugging their special needs child" />
      </section>
      <Hero title="Our mission" />
      <section className="site-split">
        <Scene size="split" name="parentChildHome" label="A parent and child at home" />
        <div className="site-split-text">
          <h2>For parents</h2>
          <p>
            You should not have to worry about the ride. We help make sure the driver arrives on time, and your child is
            picked up and dropped off safely.
          </p>
          <ParentButtons small />
        </div>
      </section>
      <section className="site-split">
        <Scene size="split" name="wheelchair" label="A driver helping a child in a wheelchair up the van ramp" />
        <div className="site-split-text">
          <h2>For companies</h2>
          <p>
            Your day should run smoother, with fewer calls and less guesswork. SafeTurns helps you organize your routes, your
            team, and your payroll, so you can spend more time growing your business.
          </p>
          <AudienceButtons to="/companies" />
        </div>
      </section>
      <section className="site-split">
        <Scene size="split" name="teacherWelcome" label="A teacher welcoming a student at the school door" />
        <div className="site-split-text">
          <h2>For schools</h2>
          <p>
            Start each day knowing who is on board and where they are. SafeTurns gives your school clear updates, so there
            are fewer surprises when a driver or student does not show up.
          </p>
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
        title="Run your transportation day in one place."
        lead="SafeTurns gives your team a clear daily schedule, driver and student updates, and payroll tools, all in one app. Fewer phone calls, less paperwork, and more time to grow your business."
      >
        <DemoRequest audience="company" />
      </Hero>
      <section className="site-wide">
        <Scene size="hero" name="fleet" label="A fleet of accessible vans and a driver" />
      </section>
      <section className="site-section" id="benefits">
        <h2>Less stress for your team.</h2>
        <Cards
          items={[
            { title: 'Clear daily routes and schedules', icon: 'route' },
            { title: 'Driver, monitor, and student check-ins', icon: 'check' },
            { title: 'Payroll and tracking in one place', icon: 'list' },
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
        title="Every student, accounted for."
        lead="Mornings and afternoons should feel calm, not like a guessing game. SafeTurns lets your school see when a student is missing and keeps your front office up to date, so your staff can spend their energy on the children. Fewer surprises, and a lot fewer panicked phone calls."
      >
        <DemoRequest audience="school" />
      </Hero>
      <section className="site-wide">
        <Scene size="hero" name="staffGreeting" label="School staff greeting students at drop-off" />
      </section>
      <section className="site-section" id="benefits">
        <h2>Clear, from the front office.</h2>
        <Cards
          items={[
            { title: 'Know when a student is missing', icon: 'bell' },
            { title: 'Clear updates for the front office', icon: 'school' },
            { title: 'Fewer surprises each morning and afternoon', icon: 'calm' },
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
