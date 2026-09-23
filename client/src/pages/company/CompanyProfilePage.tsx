import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Field, Input } from '../../components/Input'
import { StateAutocomplete } from '../../components/StateAutocomplete'
import { ProfileCard } from '../../components/ProfileCard'
import { PageIntro } from '../../components/Records'
import { useToast } from '../../components/Toast'
import { PageTopBar } from '../../layouts/TopBar'
import type { Company } from '../../types/api'

// Company Admin's own org profile (design 5a profile page). Companies store name, one address
// line, state, zip and phone; the design's separate Email and City fields have no column yet
// (see DESIGN_REPORT.md), so they're not shown.
export function CompanyProfilePage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const companyQuery = useQuery({ queryKey: ['company-me'], queryFn: () => api.get<Company>('/companies/me') })

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [zip, setZip] = useState('')
  const [state, setState] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)

  function load(c: Company | undefined) {
    if (!c) return
    setName(c.name)
    setAddress(c.address ?? '')
    setZip(c.zip_code ?? '')
    setState(c.state ?? '')
    setPhone(c.phone ?? '')
    setError(null)
  }

  useEffect(() => load(companyQuery.data), [companyQuery.data])

  const c = companyQuery.data
  const dirty = Boolean(c) && (name !== c!.name || address !== (c!.address ?? '') || zip !== (c!.zip_code ?? '') || state !== (c!.state ?? '') || phone !== (c!.phone ?? ''))

  const save = useMutation({
    mutationFn: () => api.patch<Company>('/companies/me', { name, address, zip_code: zip, state, phone: phone || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-me'] })
      toast.show('Company profile saved')
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save changes.'),
  })

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="Company profile" />
      <PageIntro>Shown to schools and parents you work with.</PageIntro>
      {companyQuery.isLoading ? (
        <p className="text-[14px] text-muted">Loading…</p>
      ) : (
        <ProfileCard
          saving={save.isPending}
          dirty={dirty}
          error={error}
          onCancel={() => load(c)}
          onSubmit={() => {
            setError(null)
            save.mutate()
          }}
        >
          <Field label="Company name" className="sm:col-span-2">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Phone" className="sm:col-span-2">
            <Input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555-0123" />
            <span className="text-[12px] font-normal text-muted">Parents see this as your dispatch number.</span>
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
        </ProfileCard>
      )}
      {toast.node}
    </div>
  )
}
