import { useNavigate } from 'react-router-dom'
import { DemoRequest } from './DemoRequest'

// The public website's text pages. Placeholder wording only; the real copy comes later.

export function HomePage() {
  return (
    <>
      <h1>SafeTurns</h1>
      <p>
        School transportation management: transport companies run drivers, monitors, vans and routes; schools
        confirm pickups and drop-offs; parents follow their children's rides.
      </p>
    </>
  )
}

export function AboutPage() {
  return (
    <>
      <h1>About us</h1>
      <p>SafeTurns connects transport companies, schools and parents around every school ride.</p>
    </>
  )
}

export function MissionPage() {
  return (
    <>
      <h1>Mission</h1>
      <p>Every child picked up, every child dropped off, and everyone who needs to know, told.</p>
    </>
  )
}

export function PublicCompaniesPage() {
  return (
    <>
      <h1>Companies</h1>
      <p>For transport companies: drivers, monitors, vans, routes and assignments in one place.</p>
      <DemoRequest audience="company" />
    </>
  )
}

export function PublicSchoolsPage() {
  return (
    <>
      <h1>Schools</h1>
      <p>For schools: students, staff access and pickup and drop-off confirmation.</p>
      <DemoRequest audience="school" />
    </>
  )
}

// No self sign-up: parent accounts come from the child's transport company or school.
export function PublicParentsPage() {
  const navigate = useNavigate()
  return (
    <>
      <h1>Parents</h1>
      <p>Follow your children's rides. Your account is set up by your child's transport company or school.</p>
      <button type="button" onClick={() => navigate('/contact')}>Contact us</button>
      <button type="button" onClick={() => navigate('/login')}>Log in</button>
    </>
  )
}
