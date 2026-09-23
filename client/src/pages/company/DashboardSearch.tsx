import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { SearchField, matches } from '../../components/Records'
import { StatusBadge } from '../../components/StatusBadge'
import type { DriverSession, PublicUser, Student, Van } from '../../types/api'

// Typeahead search across drivers, vans and students (brought back on the refreshed dashboard,
// per Anas's call). Client-side filtering of data the dashboard already loaded, no new endpoint.
// A result opens the page that manages it.
export function DashboardSearch({
  drivers,
  vans,
  students,
  sessions,
}: {
  drivers: PublicUser[]
  vans: Van[]
  students: Student[]
  sessions: DriverSession[]
}) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const active = q.trim().length > 0
  const openIds = new Set(sessions.filter((s) => s.check_out_at === null).map((s) => s.user_id))

  const d = active ? drivers.filter((x) => matches(q, x.full_name, x.email, x.phone)).slice(0, 5) : []
  const v = active ? vans.filter((x) => matches(q, x.number, x.license_plate, x.brand, x.model)).slice(0, 5) : []
  const s = active ? students.filter((x) => matches(q, x.full_name, x.parent_name)).slice(0, 5) : []

  function go(path: string) {
    setQ('')
    navigate(path)
  }

  return (
    <div className="relative">
      <SearchField value={q} onChange={setQ} placeholder="Search drivers, vans, students" />
      {active && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setQ('')} />
          <div className="absolute top-full right-0 z-40 mt-1 flex max-h-[26rem] w-[22rem] flex-col overflow-y-auto rounded-btn bg-surface p-1.5 shadow-drawer">
            <Group title="Drivers" count={d.length}>
              {d.map((x) => (
                <Result key={x.id} onClick={() => go('/company/drivers')} main={x.full_name} aside={openIds.has(x.id) ? <StatusBadge tone="success" label="Checked in" /> : <StatusBadge tone="neutral" label="Not in" />} />
              ))}
            </Group>
            <Group title="Vans" count={v.length}>
              {v.map((x) => (
                <Result key={x.id} onClick={() => go('/company/vans')} main={x.number ? `Van ${x.number}` : x.license_plate} aside={<span className="text-[12px] text-muted">{x.brand} {x.model}</span>} />
              ))}
            </Group>
            <Group title="Students" count={s.length}>
              {s.map((x) => (
                <Result key={x.id} onClick={() => go('/company/students')} main={x.full_name} aside={<span className="text-[12px] text-muted">{x.grade ? `Grade ${x.grade}` : ''}</span>} />
              ))}
            </Group>
            {d.length + v.length + s.length === 0 && <p className="px-3 py-4 text-center text-[13px] text-muted">No results for &ldquo;{q}&rdquo;.</p>}
          </div>
        </>
      )}
    </div>
  )
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null
  return (
    <div className="flex flex-col py-1">
      <span className="px-2.5 pb-1 text-group-label text-faint">{title}</span>
      {children}
    </div>
  )
}

function Result({ main, aside, onClick }: { main: string; aside: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-10 cursor-pointer items-center justify-between gap-3 rounded-row px-2.5 text-left hover:bg-surface-2">
      <span className="truncate text-[14px] font-medium text-ink">{main}</span>
      {aside}
    </button>
  )
}
