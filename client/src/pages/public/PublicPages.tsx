import { Link, useNavigate } from 'react-router-dom'
import { DemoRequest } from './DemoRequest'

// The public website's text pages. Wording from the "SafeTurns Website" Claude Design project,
// minus anything the app doesn't do yet (live map, ETA: see V2_ROADMAP.md) and minus self sign-up.

type Item = { title: string; text: string }

function ItemList({ items }: { items: Item[] }) {
  return (
    <ul>
      {items.map((i) => (
        <li key={i.title}>
          <h3>{i.title}</h3>
          <p>{i.text}</p>
        </li>
      ))}
    </ul>
  )
}

const AUDIENCES = [
  { title: 'Companies', text: 'Plan routes and guide drivers with ease.', to: '/companies' },
  { title: 'Schools', text: 'Know who is coming and when.', to: '/schools' },
  { title: 'Parents', text: "Follow your child's ride.", to: '/parents' },
]

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
      <section>
        <p>Safer rides for special needs transportation</p>
        <h1>Every ride. Every child. Safely tracked.</h1>
        <p>SafeTurns helps transportation teams, schools, and families know where every child is, from pickup to drop-off.</p>
        <Link to="/about">Learn more</Link>
      </section>
      <section>
        <h2>One calm app for everyone who cares about the ride.</h2>
        <ul>
          {AUDIENCES.map((a) => (
            <li key={a.title}>
              <h3>{a.title}</h3>
              <p>{a.text}</p>
              <Link to={a.to}>Learn more</Link>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>How it works</h2>
        <p>Three simple steps.</p>
        <ol>
          {STEPS.map((s) => (
            <li key={s.title}>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h2>Calm for drivers. Clear for schools. Comforting for parents.</h2>
        <ItemList items={FEATURES} />
      </section>
    </>
  )
}

export function AboutPage() {
  return (
    <>
      <h1>We help move the kids who need the most care.</h1>
      <p>
        SafeTurns was built with drivers, schools, and parents. We make special needs transportation simple to run and
        easy to trust.
      </p>
      <section>
        <h2>Our story is simple.</h2>
        <p>Every day, thousands of children ride to school with special care needs. Their families want to know they are safe.</p>
        <p>Transportation teams work hard to make that happen. We give them one clear tool to plan, run, and share every ride.</p>
      </section>
      <section>
        <h2>What we value</h2>
        <ItemList items={VALUES} />
      </section>
    </>
  )
}

export function MissionPage() {
  return (
    <>
      <h1>Every child home safe. Every day.</h1>
      <p>We help the people behind each ride work together, so families can let go of the worry.</p>
      <section>
        <h2>Every route, under control.</h2>
        <p>See every van and every rider in one place. Drivers know each child's needs before they arrive.</p>
        <Link to="/companies">For companies</Link>
      </section>
      <section>
        <h2>Every student, accounted for.</h2>
        <p>Know who is on board and confirm each pickup and drop-off. Staff are ready at the door for every student.</p>
        <Link to="/schools">For schools</Link>
      </section>
    </>
  )
}

export function PublicCompaniesPage() {
  return (
    <>
      <h1>Run every route with confidence.</h1>
      <p>Plan routes, guide drivers, and keep families informed. All in one place.</p>
      <DemoRequest audience="company" />
      <section>
        <h2>Less stress for your team.</h2>
        <ItemList
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
      <h1>Know every student is on the way.</h1>
      <p>See who is on board and confirm each pickup and drop-off. Be ready at the door.</p>
      <DemoRequest audience="school" />
      <section>
        <h2>Clear, from the front office.</h2>
        <ItemList
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
  const navigate = useNavigate()
  return (
    <>
      <h1>Follow your child's ride.</h1>
      <p>Know when they are picked up and when they arrive.</p>
      <p>Your account is set up by your child's transport company or school.</p>
      <button type="button" onClick={() => navigate('/contact')}>Contact us</button>
      <button type="button" onClick={() => navigate('/login')}>Log in</button>
      <section>
        <h2>Peace of mind, in your pocket.</h2>
        <ItemList
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
