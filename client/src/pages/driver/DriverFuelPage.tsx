import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Button } from '../../components/Button'
import { Card, CardHeader, CardTitle } from '../../components/Card'
import { Field, Input, Select } from '../../components/Input'
import { SectionHeader } from '../../components/mobile'
import { PageTopBar } from '../../layouts/TopBar'
import { MD_QUERY, useMediaQuery } from '../../lib/useMediaQuery'
import type { FuelEntry } from '../../types/api'

interface MyFuel {
  vans: { id: string; label: string; current_miles: number | null }[]
  entries: FuelEntry[]
}

// Driver, Fuel tab (branch van-maintenance): add the odometer reading (required) and, after a fill
// up, gallons and cost (optional). The newest reading keeps the van's oil changes and other
// mileage items on time. The office fixes mistakes; a driver only adds.
export function DriverFuelPage() {
  const wide = useMediaQuery(MD_QUERY)
  const queryClient = useQueryClient()
  const q = useQuery({ queryKey: ['fleet', 'mine'], queryFn: () => api.get<MyFuel>('/fleet/fuel/mine') })
  const [vanId, setVanId] = useState('')
  const [miles, setMiles] = useState('')
  const [gallons, setGallons] = useState('')
  const [cost, setCost] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const vans = q.data?.vans ?? []
  const van = vans.find((v) => v.id === vanId) ?? vans[0]

  const add = useMutation({
    mutationFn: () =>
      api.post<FuelEntry>('/fleet/fuel', {
        van_id: van?.id,
        miles: Number(miles),
        gallons: gallons.trim() === '' ? null : Number(gallons),
        cost: cost.trim() === '' ? null : Number(cost),
      }),
    onMutate: () => {
      setError(null)
      setSaved(null)
    },
    onSuccess: (e) => {
      setSaved(`Saved: ${e.miles.toLocaleString()} miles.`)
      setMiles('')
      setGallons('')
      setCost('')
      void queryClient.invalidateQueries({ queryKey: ['fleet', 'mine'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save. Try again.'),
  })

  const form = (
    <Card>
      <CardHeader>
        <CardTitle>Add a reading</CardTitle>
      </CardHeader>
      {q.isLoading ? (
        <p className="px-5 py-4 text-[14px] text-muted">Loading…</p>
      ) : vans.length === 0 ? (
        <p className="px-5 py-4 text-[14px] text-muted">You have no van assigned, so there is nothing to enter.</p>
      ) : (
        <form
          className="flex flex-col gap-3 px-5 py-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            add.mutate()
          }}
        >
          {vans.length > 1 ? (
            <Field label="Van">
              <Select value={van?.id} onChange={(e) => setVanId(e.target.value)}>
                {vans.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <p className="text-[14px] text-ink">
              <b className="font-semibold">{van?.label}</b>
              {van?.current_miles !== null && van?.current_miles !== undefined ? ` · last reading ${van.current_miles.toLocaleString()} miles` : ' · no reading yet'}
            </p>
          )}
          <Field label="Odometer (miles)">
            <Input required type="number" inputMode="numeric" min={0} value={miles} onChange={(e) => setMiles(e.target.value)} placeholder="e.g. 45210" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Gallons (optional)">
              <Input type="number" inputMode="decimal" min={0} step="0.01" value={gallons} onChange={(e) => setGallons(e.target.value)} />
            </Field>
            <Field label="Cost $ (optional)">
              <Input type="number" inputMode="decimal" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
            </Field>
          </div>
          {error && (
            <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="rounded-row bg-success-bg px-3 py-2 text-[13px] text-success-fg">
              {saved}
            </p>
          )}
          <Button type="submit" size="lg" disabled={add.isPending || !miles}>
            <span className="material-symbols-outlined !text-[20px]">local_gas_station</span>
            {add.isPending ? 'Saving…' : 'Save reading'}
          </Button>
        </form>
      )}
    </Card>
  )

  const recent = (
    <Card>
      <CardHeader>
        <CardTitle>Recent</CardTitle>
      </CardHeader>
      {(q.data?.entries ?? []).length === 0 ? (
        <p className="px-5 py-4 text-[14px] text-muted">No readings yet.</p>
      ) : (
        <ul>
          {(q.data?.entries ?? []).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 border-t border-divider px-5 py-2.5 text-[14px]">
              <span className="font-medium text-ink tabular">{e.miles.toLocaleString()} mi</span>
              <span className="text-[13px] text-muted">
                {[e.entry_date, e.gallons !== null ? `${e.gallons} gal` : null, e.cost !== null ? `$${e.cost.toFixed(2)}` : null].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )

  if (wide) {
    return (
      <div className="flex flex-col gap-5">
        <PageTopBar title="Fuel" />
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {form}
          {recent}
        </div>
      </div>
    )
  }
  return (
    <>
      <SectionHeader title="Fuel and odometer" />
      <div className="flex flex-col gap-3 px-4 pb-6">
        {form}
        {recent}
      </div>
    </>
  )
}
