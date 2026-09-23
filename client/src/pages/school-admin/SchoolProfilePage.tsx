import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Field, Input } from '../../components/Input'
import { StateAutocomplete } from '../../components/StateAutocomplete'
import { ProfileCard } from '../../components/ProfileCard'
import { PageIntro } from '../../components/Records'
import { useToast } from '../../components/Toast'
import { PageTopBar } from '../../layouts/TopBar'
import type { School } from '../../types/api'

// School Admin's own org profile (design 5a profile page). Before this page there was no way
// for a school_admin to edit their school's info after claiming it. Schools store one address
// line (no separate City field yet, see DESIGN_REPORT.md).
export function SchoolProfilePage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const schoolQuery = useQuery({ queryKey: ['school-me'], queryFn: () => api.get<School>('/schools/me') })

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [zip, setZip] = useState('')
  const [state, setState] = useState('')
  const [phone, setPhone] = useState('')
  const [hours, setHours] = useState('')
  const [website, setWebsite] = useState('')
  const [error, setError] = useState<string | null>(null)

  function load(s: School | undefined) {
    if (!s) return
    setName(s.name)
    setAddress(s.address ?? '')
    setZip(s.zip_code ?? '')
    setState(s.state ?? '')
    setPhone(s.phone ?? '')
    setHours(s.hours ?? '')
    setWebsite(s.website ?? '')
    setError(null)
  }

  useEffect(() => load(schoolQuery.data), [schoolQuery.data])

  const s = schoolQuery.data
  const dirty =
    Boolean(s) &&
    (name !== s!.name ||
      address !== (s!.address ?? '') ||
      zip !== (s!.zip_code ?? '') ||
      state !== (s!.state ?? '') ||
      phone !== (s!.phone ?? '') ||
      hours !== (s!.hours ?? '') ||
      website !== (s!.website ?? ''))

  const save = useMutation({
    mutationFn: () =>
      api.patch<School>('/schools/me', {
        name, address, zip_code: zip, state, phone: phone || null, hours: hours || null, website: website || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['school-me'] })
      toast.show('School profile saved')
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save changes.'),
  })

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="School profile" />
      <PageIntro>Shown to drivers and transport companies.</PageIntro>
      {schoolQuery.isLoading ? (
        <p className="text-[14px] text-muted">Loading…</p>
      ) : (
        <ProfileCard
          saving={save.isPending}
          dirty={dirty}
          error={error}
          onCancel={() => load(s)}
          onSubmit={() => {
            setError(null)
            save.mutate()
          }}
        >
          <Field label="School name" className="sm:col-span-2">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555-0123" />
          </Field>
          <Field label="Website">
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="school.example.org" />
          </Field>
          <Field label="Street address" className="sm:col-span-2">
            <Input required placeholder="Street, city" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="State">
            <StateAutocomplete required value={state} onChange={setState} />
          </Field>
          <Field label="ZIP">
            <Input required placeholder="02139" value={zip} onChange={(e) => setZip(e.target.value)} />
          </Field>
          <Field label="Hours" className="sm:col-span-2">
            <Input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="8:00 AM – 3:00 PM" />
          </Field>
        </ProfileCard>
      )}
      {toast.node}
    </div>
  )
}
