// End-to-end role flows against a RUNNING API (not part of `npm test`).
//   API_BASE=http://localhost:4000 node scripts/e2e-roles.mjs
// Signs up its own throwaway companies/school ("MVP Test ..." names, @example.test emails) and
// walks every role's main flow: company admin setup, driver check-in/trip/check-out, parent view,
// school admin confirm, school staff scoping, driver scoping (a driver only reaches students,
// vans and schools on their own not-ended assignments), cross-company isolation. It writes real rows to
// whatever database that API uses and does not clean them up (trips/sessions have no delete).
const BASE = process.env.API_BASE || 'http://localhost:4000'
const PW = 'Secret123!'
const stamp = Date.now().toString(36)
let passed = 0
let failed = 0
const created = []

function check(cond, msg, extra) {
  if (cond) { passed++; console.log('  ✓', msg) }
  else { failed++; console.log('  ✗ FAIL:', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '') }
}
async function api(method, path, token, body) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const r = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, body: data }
}
// Accounts made with POST /users get a temporary password and must set their own first
// (auth-accounts). Checks that, then sets PW so the rest of the script can log in normally.
async function activate(email, created) {
  const temp = created.body?.temporary_password
  check(Boolean(temp) && created.body?.must_change_password === true, `${email}: temporary password returned, change required`, created.body)
  const first = await login(email, temp)
  check(first.user.must_change_password === true, `${email}: first login says must change password`)
  const blocked = await api('GET', '/auth/me', first.token)
  check(blocked.status === 200, `${email}: /auth/me allowed before the change`, blocked)
  const changed = await api('POST', '/auth/change-password', first.token, { currentPassword: temp, newPassword: PW })
  check(changed.status === 200, `${email}: set own password -> 200`, changed)
}

async function login(email, password = PW) {
  const r = await api('POST', '/auth/login', null, { email, password })
  if (r.status !== 200) throw new Error(`login ${email} -> ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

async function main() {
  console.log('\n--- Sign up test orgs (self-serve) ---')
  const signup = async (kind, orgName, email) => {
    const r = await api('POST', `/signup/${kind}`, null, { orgName, address: '1 Test Rd, Springfield', zip: '62704', state: 'IL', fullName: `MVP Test Admin ${stamp}`, email, password: PW })
    check(r.status === 201, `signup ${kind} "${orgName}" -> 201`, r)
    created.push(`${kind} "${orgName}" + admin ${email}`)
    return r
  }
  const coEmail = `mvp-coadmin-${stamp}@example.test`
  const co2Email = `mvp-coadmin2-${stamp}@example.test`
  const saEmail = `mvp-schooladmin-${stamp}@example.test`
  await signup('company', `MVP Test Transport ${stamp}`, coEmail)
  await signup('company', `MVP Test Other Co ${stamp}`, co2Email)
  await signup('school', `MVP Test Elementary ${stamp}`, saEmail)

  console.log('\n--- Company admin ---')
  const admin = await login(coEmail)
  const A = admin.token
  const SAlogin = await login(saEmail)
  const willow = { id: SAlogin.user.tenantId }

  const schools = await api('GET', '/schools', A)
  check(schools.status === 200 && Array.isArray(schools.body), 'GET /schools', schools)

  const ph = await api('POST', '/placeholders/school', A, { name: `MVP Test School ${stamp}`, address: '1 Test Rd, Springfield, IL 62704' })
  check(ph.status === 201, 'create school (placeholder) -> 201', ph)
  if (ph.body?.id) created.push(`school placeholder "${ph.body.name}" (${ph.body.id})`)

  const drvEmail = `mvp-driver-${stamp}@example.test`
  const drv = await api('POST', '/users', A, { role: 'driver', fullName: `MVP Test Driver ${stamp}`, email: drvEmail, phone: '555-0100', address: '1 Test St', licenseNumber: 'T123' })
  check(drv.status === 201, 'create driver -> 201', drv)
  created.push(`driver ${drvEmail} (${drv.body?.id})`)
  await activate(drvEmail, drv)

  const van = await api('POST', '/vans', A, { number: `T${stamp.slice(-3)}`, license_plate: `MVP-${stamp}`, brand: 'Ford', model: 'Transit', year: 2022, color: 'White' })
  check(van.status === 201 && van.body.number === `T${stamp.slice(-3)}`, 'create van with number -> 201, number returned', van)
  created.push(`van MVP-${stamp} (${van.body?.id})`)
  const vanUpd = await api('PATCH', `/vans/${van.body.id}`, A, { number: `U${stamp.slice(-3)}` })
  check(vanUpd.status === 200 && vanUpd.body.number === `U${stamp.slice(-3)}`, 'update van number', vanUpd)

  const stu = await api('POST', '/students', A, {
    full_name: `MVP Test Student ${stamp}`, grade: '3', age: 8, parent_name: 'MVP Test Parent', parent_phone: '555-0101',
    street_address: '2 Test St', city: 'Springfield', state: 'IL', zip_code: '62704', notes: 'None', school_id: willow.id,
  })
  check(stu.status === 201, 'create student at the test school -> 201', stu)
  created.push(`student "MVP Test Student ${stamp}" (${stu.body?.id})`)

  const asg = await api('POST', '/assignments', A, {
    student_id: stu.body.id, driver_user_id: drv.body.id, van_id: van.body.id, start_date: today, shift_period: 'both', pickup_time: '07:10', dropoff_time: '15:20',
  })
  check(asg.status === 201, 'create assignment (today, both shifts) -> 201', asg)
  created.push(`assignment ${asg.body?.id}`)

  const rule = await api('PUT', `/payroll/rules/${drv.body.id}`, A, { rate_type: 'hourly', rate_cents: 2000 })
  check(rule.status === 200 || rule.status === 201, 'set pay rate', rule)
  const unpaid = await api('GET', `/payroll/unpaid-summary/${drv.body.id}`, A)
  check(unpaid.status === 200 && typeof unpaid.body.total_pay_cents === 'number', 'payroll unpaid summary', unpaid)
  const rules = await api('GET', '/payroll/rules', A)
  check(rules.status === 200 && rules.body.some((r) => r.driver_id === drv.body.id), 'payroll rules list includes the driver')

  const comp = await api('PATCH', '/companies/me', A, { city: 'Springfield' })
  check(comp.status === 200 && comp.body.city === 'Springfield', 'company city saved (new column)', comp)

  console.log('\n--- Driver ---')
  const D = (await login(drvEmail)).token
  const sched = await api('GET', '/schedule/today', D)
  check(sched.status === 200 && sched.body.some((i) => i.student.id === stu.body.id), 'driver sees the student on today\'s schedule', sched)
  const vans = await api('GET', '/vans', D)
  check(vans.body.some((v) => v.id === van.body.id && v.number), 'driver can read their van number')
  const ci = await api('POST', '/sessions/checkin', D, { shift_period: 'morning' })
  check(ci.status === 201, 'check in (morning) -> 201', ci)
  const trip = await api('POST', '/trips', D, { student_id: stu.body.id, trip_type: 'pickup', shift_period: 'morning' })
  check(trip.status === 201 && trip.body.status === 'pending', 'log pickup -> pending trip', trip)
  const trips = await api('GET', '/trips', D)
  check(trips.body.some((t) => t.id === trip.body.id), 'trip in driver\'s list')

  console.log('\n--- Driver scope (only own, not-ended assignments) ---')
  const mkStudent = async (label) => {
    const r = await api('POST', '/students', A, {
      full_name: `MVP Test Student ${label} ${stamp}`, grade: '3', age: 8, parent_name: 'MVP Test Parent', parent_phone: '555-0101',
      street_address: '3 Test St', city: 'Springfield', state: 'IL', zip_code: '62704', notes: 'None', school_id: willow.id,
    })
    check(r.status === 201, `create student ${label} -> 201`, r)
    created.push(`student "MVP Test Student ${label} ${stamp}" (${r.body?.id})`)
    return r.body
  }
  const drv2Email = `mvp-driver2-${stamp}@example.test`
  const drv2 = await api('POST', '/users', A, { role: 'driver', fullName: `MVP Test Driver Two ${stamp}`, email: drv2Email, phone: '555-0110', address: '1 Test St', licenseNumber: 'T124' })
  check(drv2.status === 201, 'create second driver -> 201', drv2)
  created.push(`driver ${drv2Email} (${drv2.body?.id})`)
  await activate(drv2Email, drv2)
  const van2 = await api('POST', '/vans', A, { license_plate: `MVP2-${stamp}`, brand: 'Ford', model: 'Transit', year: 2022, color: 'White' })
  check(van2.status === 201, 'create second van -> 201', van2)
  created.push(`van MVP2-${stamp} (${van2.body?.id})`)
  const stuOther = await mkStudent('Other Driver')
  const stuEnded = await mkStudent('Ended')
  const stuFuture = await mkStudent('Future')
  const asgOther = await api('POST', '/assignments', A, { student_id: stuOther.id, driver_user_id: drv2.body.id, van_id: van2.body.id, start_date: today, shift_period: 'both' })
  check(asgOther.status === 201, "assignment for driver two's student -> 201", asgOther)
  const asgEnded = await api('POST', '/assignments', A, { student_id: stuEnded.id, driver_user_id: drv.body.id, van_id: van.body.id, start_date: '2020-01-01', end_date: '2020-12-31', shift_period: 'both' })
  check(asgEnded.status === 201, 'ended assignment for driver one -> 201', asgEnded)
  const asgFuture = await api('POST', '/assignments', A, { student_id: stuFuture.id, driver_user_id: drv.body.id, van_id: van.body.id, start_date: '2099-01-01', shift_period: 'both' })
  check(asgFuture.status === 201, 'future assignment for driver one -> 201', asgFuture)
  for (const a of [asgOther, asgEnded, asgFuture]) created.push(`assignment ${a.body?.id}`)

  const dStudents = await api('GET', '/students', D)
  const dIds = (dStudents.body ?? []).map((s) => s.id).sort()
  check(JSON.stringify(dIds) === JSON.stringify([stu.body.id, stuFuture.id].sort()), 'driver GET /students = own active + future students only', dStudents.body?.map((s) => s.full_name))
  check((await api('GET', `/students/${stuOther.id}`, D)).status === 404, "driver can't read another driver's student (404)")
  check((await api('GET', `/students/${stuEnded.id}`, D)).status === 404, "driver can't read an ended assignment's student (404)")
  check((await api('GET', `/students/${stuFuture.id}`, D)).status === 200, "driver can read a future assignment's student")
  const dVans = await api('GET', '/vans', D)
  check(dVans.status === 200 && dVans.body.every((v) => v.id === van.body.id), 'driver GET /vans = only their own van', dVans.body?.map((v) => v.license_plate))
  check((await api('GET', `/vans/${van2.body.id}`, D)).status === 404, "driver can't read another driver's van (404)")
  check((await api('GET', `/schools/${willow.id}`, D)).status === 200, "driver can read their student's school")
  const dAsg = await api('GET', '/assignments', D)
  check(dAsg.status === 200 && !dAsg.body.some((a) => a.id === asgEnded.body.id), 'driver GET /assignments leaves out the ended one')
  check((await api('POST', '/trips', D, { student_id: stuOther.id, trip_type: 'pickup', shift_period: 'morning' })).status === 404, "driver can't log a trip for another driver's student (404)")
  check((await api('POST', '/trips', D, { student_id: stuEnded.id, trip_type: 'pickup', shift_period: 'morning' })).status === 404, "driver can't log a trip for an ended assignment's student (404)")
  check((await api('POST', '/trips', D, { student_id: stuFuture.id, trip_type: 'pickup', shift_period: 'morning' })).status === 409, "driver can't log a trip for a student who isn't on today's run (409)")
  check((await api('POST', `/schedule/${asgOther.body.id}/no-show`, D, { shift_period: 'morning' })).status === 404, "driver can't report a no-show on another driver's assignment (404)")
  const D2 = (await login(drv2Email)).token
  check((await api('GET', `/students/${stu.body.id}`, D2)).status === 404, "driver two can't read driver one's student (404)")

  console.log('\n--- Parent ---')
  const parEmail = `mvp-parent-${stamp}@example.test`
  const par = await api('POST', '/users', A, { role: 'parent', fullName: `MVP Test Parent ${stamp}`, email: parEmail, phone: '555-0101', address: '2 Test St' })
  check(par.status === 201, 'create parent -> 201', par)
  created.push(`parent ${parEmail} (${par.body?.id})`)
  await activate(parEmail, par)
  const link = await api('POST', '/parent-access', A, { parent_user_id: par.body.id, student_id: stu.body.id })
  check(link.status === 201, 'link parent to student', link)
  const P = (await login(parEmail)).token
  const kids = await api('GET', '/parent/students', P)
  check(kids.body?.length === 1 && kids.body[0].id === stu.body.id, 'parent sees only their child', kids)
  const det = await api('GET', `/parent/students/${stu.body.id}/detail`, P)
  check(det.status === 200 && det.body.trips_today.some((t) => t.trip_type === 'pickup'), 'parent sees today\'s pickup', det)
  check(det.body?.transport?.[0]?.van?.number === `U${stamp.slice(-3)}`, 'parent detail includes van number', det.body?.transport)
  const skipStatus = await api('GET', `/parent/students/${stu.body.id}/skip-status`, P)
  check(skipStatus.status === 200, 'parent skip-status', skipStatus)

  console.log('\n--- School admin / staff ---')
  const SA = SAlogin.token
  const saStudents = await api('GET', '/students', SA)
  const saRow = saStudents.body?.find((s) => s.id === stu.body.id)
  check(Boolean(saRow), 'school admin sees the new student at their school')
  check(saRow?.transport?.[0]?.van?.number === `U${stamp.slice(-3)}`, 'school transport includes van number', saRow?.transport)
  check(!saStudents.body.some((s) => s.school_id !== willow.id), 'school admin only sees their own school', saStudents.body.map((s) => s.school_id))
  const saTrips = await api('GET', '/trips', SA)
  check(saTrips.body?.some((t) => t.id === trip.body.id), 'school admin sees today\'s trip')
  const conf = await api('POST', `/trips/${trip.body.id}/confirm`, SA)
  check(conf.status === 200 && conf.body.status === 'complete', 'school admin confirms the trip -> complete', conf)
  const stEmail = `mvp-staff-${stamp}@example.test`
  const stCreate = await api('POST', '/users', SA, { role: 'school_staff', fullName: `MVP Test Staff ${stamp}`, email: stEmail })
  check(stCreate.status === 201, 'school admin creates a staff account', stCreate)
  created.push(`school staff ${stEmail}`)
  await activate(stEmail, stCreate)
  const ST = (await login(stEmail)).token
  const stStudents = await api('GET', '/students', ST)
  check(stStudents.status === 200 && !stStudents.body.some((s) => s.id === stu.body.id), 'school staff does NOT see an ungranted student', stStudents.body?.map((s) => s.full_name))
  const stTrips = await api('GET', '/trips', ST)
  check(!stTrips.body?.some((t) => t.id === trip.body.id), 'school staff does NOT see the ungranted student\'s trip')
  const absent = await api('GET', '/dashboard/absent-today', SA)
  check(absent.status === 200, 'school admin absent-today')

  console.log('\n--- Driver check out ---')
  const co = await api('POST', `/sessions/${ci.body.id}/checkout`, D, {})
  check(co.status === 200 && co.body.check_out_at, 'check out -> 200', co)

  console.log('\n--- Cross-company isolation ---')
  const G = (await login(co2Email)).token
  const gv = await api('GET', `/vans/${van.body.id}`, G)
  check(gv.status === 404, "another company can't read this van", gv)
  const gs = await api('GET', `/students/${stu.body.id}`, G)
  check(gs.status === 404, "another company can't read this student", gs)
  const gc = await api('GET', '/companies/me', G)
  check(gc.status === 200 && gc.body.id !== admin.user.tenantId, 'another company only gets its own profile')

  console.log(`\n==== e2e: ${passed} passed, ${failed} failed ====`)
  console.log('\nCreated (left in Neon):\n - ' + created.join('\n - '))
  console.log(`\nIDS ${JSON.stringify({ student: stu.body.id, driver: drv.body.id, van: van.body.id, assignment: asg.body.id, parent: par.body.id, trip: trip.body.id, session: ci.body.id, school: ph.body?.id, drvEmail, parEmail })}`)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
