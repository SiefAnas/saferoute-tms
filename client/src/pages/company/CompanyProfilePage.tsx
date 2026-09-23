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

// Company Admin's own org profile (design 5a profile page): name, phone, email, street, city,
// state, zip. Email and city are optional.
export function CompanyProfilePage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const companyQuery = useQuery({ queryKey: ['company-me'], queryFn: () => api.get<Company>('/companies/me') })

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [zip, setZip] = useState('')
  const [state, setState] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('')
  const [error, setError] = useState<string | null>(null)

  function load(c: Company | undefined) {
    if (!c) return
    setName(c.name)
    setAddress(c.address ?? '')
    setZip(c.zip_code ?? '')
    setState(c.state ?? '')
    setPhone(c.phone ?? '')
    setEmail(c.email ?? '')
    setCity(c.city ?? '')
    setError(null)
  }

  useEffect(() => load(companyQuery.data), [companyQuery.data])

  const c = companyQuery.data
  const dirty = Boolean(c) && (name !== c!.name || address !== (c!.address ?? '') || zip !== (c!.zip_code ?? '') || state !== (c!.state ?? '') || phone !== (c!.phone ?? '') || email !== (c!.email ?? '') || city !== (c!.city ?? ''))

  const save = useMutation({
    mutationFn: () => api.patch<Company>('/companies/me', { name, address, zip_code: zip, state, phone: phone || null, email: email.trim() || null, city: city.trim() || null }),
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
          <Field label="Phone">
            <Input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555-0123" />
            <span className="text-[12px] font-normal text-muted">Parents see this as your dispatch number.</span>
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="office@company.com" />
          </Field>
          <Field label="Street address" className="sm:col-span-2">
            <Input required placeholder="1200 Industrial Pkwy" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="City" className="sm:col-span-2">
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Springfield" />
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
