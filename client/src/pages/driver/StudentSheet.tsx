import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { formatTimeOfDay } from '../../lib/format'
import { BottomSheet, CallButton } from '../../components/mobile'
import { Avatar } from '../../components/Records'
import { homeAddress, shiftName } from './driverData'
import type { SchoolDetail, ShiftPeriod, Student } from '../../types/api'

export interface SheetTarget {
  studentId: string
  schoolId: string
  period: ShiftPeriod
  time: string | null // effective pickup/drop-off time for that shift, "HH:MM:SS"
  parentSkipped: boolean
}

// Student sheet (design 3a): who they are, where they're going on this shift, notes, every
// contact with a call button, and the school. Real data from GET /students/:id (includes
// student_contacts) and GET /schools/:id.
export function StudentSheet({ target, onClose }: { target: SheetTarget; onClose: () => void }) {
  const studentQuery = useQuery({
    queryKey: ['student', target.studentId],
    queryFn: () => api.get<Student>(`/students/${target.studentId}`),
  })
  const schoolQuery = useQuery({
    queryKey: ['school-detail', target.schoolId],
    queryFn: () => api.get<SchoolDetail>(`/schools/${target.schoolId}`),
  })
  const s = studentQuery.data
  const school = schoolQuery.data
  const home = homeAddress(s)
  const homeStop = { label: 'Home', line: home ? `${home.line1} · ${home.line2}` : 'No home address on file' }
  const schoolLine = school ? [school.address, [school.state, school.zip_code].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : ''
  const schoolStop = { label: school?.name ?? 'School', line: schoolLine || 'No address on file' }
  const [from, to] = target.period === 'morning' ? [homeStop, schoolStop] : [schoolStop, homeStop]
  const meta = s ? [s.grade ? `Grade ${s.grade}` : null, s.age != null ? `Age ${s.age}` : null].filter(Boolean).join(' · ') : ''

  return (
    <BottomSheet
      onClose={onClose}
      label={s?.full_name ?? 'Student'}
      header={
        <div className="flex items-center gap-3 px-5 pt-2.5 pb-3.5">
          <Avatar name={s?.full_name} size={44} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[18px] font-semibold text-ink">{s?.full_name ?? 'Loading…'}</span>
            {meta && <span className="text-[13px] text-muted">{meta}</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-full bg-surface-2 text-ink"
          >
            <span className="material-symbols-outlined !text-[20px]">close</span>
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5 rounded-m border border-line px-3.5 py-3">
        <span className="text-[12px] font-semibold text-muted">
          {shiftName(target.period)} {target.period === 'morning' ? 'pickup' : 'drop-off'}
          {target.time ? ` · ${formatTimeOfDay(target.time)}` : ''}
        </span>
        <div className="grid grid-cols-[14px_1fr] gap-2.5">
          <div className="flex flex-col items-center pt-1">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-ink" />
            <span className="my-[3px] w-0.5 flex-1 bg-line" />
            <span className="h-2.5 w-2.5 rounded-[2px] bg-ink" />
          </div>
          <div className="flex flex-col gap-3">
            {[from, to].map((stop, i) => (
              <div key={i} className="flex flex-col">
                <span className="text-[14px] font-medium text-ink">{stop.label}</span>
                <span className="text-[13px] text-muted">{stop.line}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {target.parentSkipped && (
        <div className="rounded-row bg-info-bg px-3 py-[9px] text-[13px] font-medium text-info-fg">
          Parent skipped this {target.period === 'morning' ? "morning's pickup" : "afternoon's drop-off"}. No stop needed.
        </div>
      )}

      {s?.notes && (
        <div className="flex gap-2.5 rounded-m bg-note-bg p-3 text-note-fg">
          <span className="material-symbols-outlined !text-[20px] text-note-icon">sticky_note_2</span>
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] font-semibold">Note</span>
            <span className="text-[14px] leading-[1.45]">{s.notes}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold text-muted">Parents &amp; contacts</span>
        {s && !s.parent_name && !s.parent_phone && (s.contacts ?? []).length === 0 && (
          <span className="text-[13px] text-muted">No contacts on file. Ask the office to add one.</span>
        )}
        {s && (s.parent_name || s.parent_phone) && (
          <ContactRow name={s.parent_name ?? 'Parent / guardian'} rel="Primary contact" phone={s.parent_phone} primary />
        )}
        {(s?.contacts ?? []).map((c) => (
          <ContactRow key={c.id} name={c.name} rel={c.relationship ?? 'Contact'} phone={c.phone} />
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-muted">School</span>
        {school ? (
          <div className="flex flex-col gap-[3px] text-[13px]">
            <span className="text-[14px] font-medium text-ink">{school.name}</span>
            {schoolLine && <span className="text-muted">{schoolLine}</span>}
            {(school.phone || school.hours) && (
              <span className="text-muted">
                {school.phone ? (
                  <a className="underline-offset-2 hover:underline" href={`tel:${school.phone.replace(/[^0-9+]/g, '')}`}>
                    {school.phone}
                  </a>
                ) : null}
                {school.phone && school.hours ? ' · ' : ''}
                {school.hours}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[13px] text-muted">Loading…</span>
        )}
      </div>
    </BottomSheet>
  )
}

function ContactRow({ name, rel, phone, primary = false }: { name: string; rel: string; phone: string | null; primary?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-m border border-line px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-medium text-ink">{name}</span>
        <span className="truncate text-[12px] text-muted">
          {rel}
          {phone ? ` · ${phone}` : ' · No phone on file'}
        </span>
      </div>
      {phone && <CallButton phone={phone} primary={primary} label={`Call ${name}`} />}
    </div>
  )
}
