import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { Button } from '../../components/Button'
import { Field, Input } from '../../components/Input'
import { AuthScreen } from '../login/AuthScreen'
import type { StaffFormValues, StaffRole } from '../../types/api'

interface LinkInfo {
  role: StaffRole
  company_name: string
}
interface OwnForm {
  role: StaffRole
  values: StaffFormValues
  editable: boolean
}

type Draft = Record<keyof StaffFormValues, string>
const EMPTY: Draft = {
  full_name: '', phone: '', email: '', van_plate: '', van_make: '', van_model: '', van_color: '', van_year: '',
}

// The edit token lives in this tab only (sessionStorage): on a shared phone, the next person to
// open the link starts a blank form instead of seeing the last person's details.
const tokenKey = (code: string) => `safeturns_staff_form:${code}`
function readToken(code: string) {
  try { return sessionStorage.getItem(tokenKey(code)) } catch { return null }
}
function writeToken(code: string, token: string | null) {
  try {
    if (token) sessionStorage.setItem(tokenKey(code), token)
    else sessionStorage.removeItem(tokenKey(code))
  } catch { /* storage blocked: the form still sends, it just can't be edited later */ }
}

const toDraft = (v: StaffFormValues): Draft => ({
  ...EMPTY,
  ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === null || x === undefined ? '' : String(x)])),
})

function toBody(role: StaffRole, d: Draft) {
  const base = { full_name: d.full_name, phone: d.phone, email: d.email }
  if (role !== 'driver') return base
  return {
    ...base,
    van_plate: d.van_plate,
    van_make: d.van_make,
    van_model: d.van_model,
    van_color: d.van_color,
    van_year: Number(d.van_year),
  }
}

// Public page a Driver link or Monitor link opens: /staff-form?code=… No sign-in. It only ever
// shows the company's name and the details this person typed themself.
export function StaffFormPage() {
  const [params] = useSearchParams()
  const code = params.get('code') ?? ''
  const [info, setInfo] = useState<LinkInfo | null>(null)
  const [linkError, setLinkError] = useState<string | null>(code ? null : 'This link is missing its code. Ask your company for the link again.')
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [own, setOwn] = useState<OwnForm | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!code) return
    let cancelled = false
    ;(async () => {
      try {
        const token = readToken(code)
        if (token) {
          try {
            const mine = await api.post<OwnForm>('/staff-form/mine', { code, edit_token: token })
            if (!cancelled) setOwn(mine)
          } catch {
            writeToken(code, null)
          }
        }
        const linkInfo = await api.post<LinkInfo>('/staff-form/link', { code })
        if (!cancelled) setInfo(linkInfo)
      } catch (err) {
        if (!cancelled) setLinkError(err instanceof ApiError ? err.message : 'This link could not be opened. Please try again.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code])

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }))
  const role = info?.role ?? own?.role

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!role) return
    setError(null)
    setSaving(true)
    try {
      if (own && editing) {
        const updated = await api.put<OwnForm>('/staff-form/mine', { code, edit_token: readToken(code), ...toBody(role, draft) })
        setOwn(updated)
      } else {
        const res = await api.post<{ edit_token: string; submission: OwnForm }>('/staff-form/submit', { code, ...toBody(role, draft) })
        writeToken(code, res.edit_token)
        setOwn(res.submission)
      }
      setEditing(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the form. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function startNew() {
    writeToken(code, null)
    setOwn(null)
    setEditing(false)
    setDraft(EMPTY)
  }

  const title = role === 'monitor' ? 'Monitor details' : 'Driver details'

  if (linkError && !own) {
    return (
      <AuthScreen title="Staff details" subtitle="SafeTurns">
        <p role="alert" className="w-full rounded-lg bg-error-container px-4 py-3 text-body-md text-on-error-container">
          {linkError}
        </p>
      </AuthScreen>
    )
  }
  if (!role) {
    return (
      <AuthScreen title="Staff details" subtitle="Loading…">
        <span />
      </AuthScreen>
    )
  }

  if (own && !editing) {
    return (
      <AuthScreen title="Thanks, your details were sent" subtitle={info ? `to ${info.company_name}` : title}>
        <div className="flex w-full flex-col gap-3 text-body-md text-on-surface">
          <p role="status">
            {info?.company_name ?? 'Your company'} will review them and email you at <b className="font-semibold">{own.values.email}</b> to set up
            your account.
          </p>
          {own.editable ? (
            <p className="text-muted">You can still change them until the company opens your form.</p>
          ) : (
            <p className="text-muted">Your company has opened your form, so it can no longer be changed. Contact them if something is wrong.</p>
          )}
        </div>
        <div className="flex w-full flex-col gap-2">
          {own.editable && info && (
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => {
                setDraft(toDraft(own.values))
                setError(null)
                setEditing(true)
              }}
            >
              Edit my details
            </Button>
          )}
          {info && (
            <button type="button" onClick={startNew} className="text-label-md text-primary hover:underline">
              Fill in a form for someone else
            </button>
          )}
        </div>
      </AuthScreen>
    )
  }

  return (
    <AuthScreen title={title} subtitle={info ? `for ${info.company_name}` : ''}>
      <form className="flex w-full flex-col gap-4" onSubmit={handleSubmit}>
        <Field label="Full name">
          <Input required autoComplete="name" value={draft.full_name} onChange={set('full_name')} />
        </Field>
        <Field label="Phone">
          <Input required type="tel" autoComplete="tel" value={draft.phone} onChange={set('phone')} />
        </Field>
        <Field label="Email">
          <Input required type="email" autoComplete="email" value={draft.email} onChange={set('email')} />
        </Field>
        {role === 'driver' && (
          <>
            <Field label="Van plate">
              <Input required value={draft.van_plate} onChange={set('van_plate')} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Van make">
                <Input required placeholder="Ford" value={draft.van_make} onChange={set('van_make')} />
              </Field>
              <Field label="Van model">
                <Input required placeholder="Transit" value={draft.van_model} onChange={set('van_model')} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Van color">
                <Input required placeholder="White" value={draft.van_color} onChange={set('van_color')} />
              </Field>
              <Field label="Van year">
                <Input required type="number" inputMode="numeric" min={1900} max={2100} value={draft.van_year} onChange={set('van_year')} />
              </Field>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-error-container px-4 py-2 text-body-md text-on-error-container">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={saving} className="w-full">
          {saving ? 'Sending…' : editing ? 'Save changes' : 'Send'}
        </Button>
        {editing && (
          <button type="button" onClick={() => setEditing(false)} className="text-label-md text-primary hover:underline">
            Cancel
          </button>
        )}
      </form>
    </AuthScreen>
  )
}
