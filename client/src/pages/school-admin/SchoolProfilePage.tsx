import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { StateAutocomplete } from '../../components/StateAutocomplete'
import type { School } from '../../types/api'

// School Admin's own org profile (§ Driver dashboard rework) — previously there was no
// way at all for a school_admin to edit their own school's info post-claim, not even the
// address set at claim time. Address/zip/state are included alongside the newly-requested
// phone/hours/website since there was nowhere else to edit them either.
export function SchoolProfilePage() {
  const queryClient = useQueryClient()
  const schoolQuery = useQuery({ queryKey: ['school-me'], queryFn: () => api.get<School>('/schools/me') })

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [zip, setZip] = useState('')
  const [state, setState] = useState('')
  const [phone, setPhone] = useState('')
  const [hours, setHours] = useState('')
  const [website, setWebsite] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const s = schoolQuery.data
    if (!s) return
    setName(s.name)
    setAddress(s.address ?? '')
    setZip(s.zip_code ?? '')
    setState(s.state ?? '')
    setPhone(s.phone ?? '')
    setHours(s.hours ?? '')
    setWebsite(s.website ?? '')
  }, [schoolQuery.data])

  const save = useMutation({
    mutationFn: () =>
      api.patch<School>('/schools/me', {
        name, address, zip_code: zip, state, phone: phone || null, hours: hours || null, website: website || null,
      }),
    onSuccess: () => {
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: ['school-me'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save changes.'),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    save.mutate()
  }

  if (schoolQuery.isLoading) return <p className="text-body-md text-on-surface-variant">Loading…</p>

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">School Profile</h1>

      <Card className="max-w-[560px] p-6">
        <CardHeader className="mb-4 -mx-6 -mt-6 rounded-t-xl">
          <h2 className="text-title-lg text-primary">Organization Info</h2>
        </CardHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <label className="text-label-md text-on-surface-variant">School name</label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-label-md text-on-surface-variant">Address</label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-2">
              <label className="text-label-md text-on-surface-variant">Zip code</label>
              <Input value={zip} onChange={(e) => setZip(e.target.value)} />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <label className="text-label-md text-on-surface-variant">State</label>
              <StateAutocomplete value={state} onChange={setState} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-label-md text-on-surface-variant">Phone</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555-0123" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-label-md text-on-surface-variant">Operational hours</label>
            <Input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Mon-Fri 7am-4pm" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-label-md text-on-surface-variant">Website</label>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-error-container px-4 py-2 text-body-md text-on-error-container">
              {error}
            </p>
          )}
          {saved && !error && <p className="text-body-md text-on-surface-variant">Saved.</p>}

          <Button type="submit" disabled={save.isPending} className="w-full">
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
