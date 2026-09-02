import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { StateAutocomplete } from '../../components/StateAutocomplete'
import type { Company } from '../../types/api'

// Company Admin's own org profile — mirrors SchoolProfilePage.tsx exactly. Added
// 2026-09-02 (§ pickup-confirmation task) because companies had no self-service profile
// edit surface at all, and the parent dashboard's new "More info" panel needed a real
// company phone number to show instead of a permanently-blank field.
export function CompanyProfilePage() {
  const queryClient = useQueryClient()
  const companyQuery = useQuery({ queryKey: ['company-me'], queryFn: () => api.get<Company>('/companies/me') })

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [zip, setZip] = useState('')
  const [state, setState] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const c = companyQuery.data
    if (!c) return
    setName(c.name)
    setAddress(c.address ?? '')
    setZip(c.zip_code ?? '')
    setState(c.state ?? '')
    setPhone(c.phone ?? '')
  }, [companyQuery.data])

  const save = useMutation({
    mutationFn: () => api.patch<Company>('/companies/me', { name, address, zip_code: zip, state, phone: phone || null }),
    onSuccess: () => {
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: ['company-me'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save changes.'),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    save.mutate()
  }

  if (companyQuery.isLoading) return <p className="text-body-md text-on-surface-variant">Loading…</p>

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">Company Profile</h1>

      <Card className="max-w-[560px] p-6">
        <CardHeader className="mb-4 -mx-6 -mt-6 rounded-t-xl">
          <h2 className="text-title-lg text-primary">Organization Info</h2>
        </CardHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <label className="text-label-md text-on-surface-variant">Company name</label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-label-md text-on-surface-variant">Address</label>
            <Input required placeholder="Street address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-2">
              <label className="text-label-md text-on-surface-variant">Zip code</label>
              <Input required placeholder="e.g. 02139" value={zip} onChange={(e) => setZip(e.target.value)} />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <label className="text-label-md text-on-surface-variant">State</label>
              <StateAutocomplete required value={state} onChange={setState} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-label-md text-on-surface-variant">Phone</label>
            <Input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555-0123" />
            <p className="text-label-md text-on-surface-variant">Shown to parents on their dashboard as your dispatch contact number.</p>
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
