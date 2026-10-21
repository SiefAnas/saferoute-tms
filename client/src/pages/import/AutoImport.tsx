import { useMemo, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { downloadCsv } from '../../lib/csv'
import { isAssignmentActiveToday } from '../../lib/format'
import { localISODate } from '../../lib/localDate'
import { readWorkbook, SPREADSHEET_ACCEPT } from '../../lib/sheet'
import { KIND_LABEL, parseSheet, type ParseContext, type ParsedSheet, type RawSheet, type SheetKind } from '../../lib/sheetParse'
import { buildPlan, checkAll, commitAll, needsOf, summaryLine, typesToSend, where, type NeedsYou, type RowStatus } from '../../lib/importPlan'
import { Button } from '../../components/Button'
import { Card, CardHeader, CardTitle } from '../../components/Card'
import { Field, Input, Select } from '../../components/Input'
import { Counts, CredentialsTable } from './importParts'
import type { Assignment, ImportCredential, ImportTypesResponse, PublicUser, SchoolSummary, Van } from '../../types/api'

// Several files at once (branch import-auto-detect). Every sheet of every file is read in the
// browser, its kind and columns worked out by plain rules (lib/sheetParse.ts), and turned into
// rows per import type (lib/importPlan.ts). The rows go to the same /imports/preview and
// /imports/commit as the one-type flow, one type at a time in dependency order. What is clear goes
// in; what isn't is listed with the reason.

type Types = ImportTypesResponse['types']
const sheetId = (s: RawSheet) => `${s.file}\u0000${s.name}`

interface NeedRow { where: string; what: string; why: string }
const toNeedRow = (n: NeedsYou): NeedRow => ({ where: where(n.source), what: n.what, why: n.why })
const post = <T,>(path: string, body: unknown) => api.post<T>(path, body)

export function AutoImport({ types, maxRows }: { types: Types; maxRows: number }) {
  const queryClient = useQueryClient()
  const drivers = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
  const vans = useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })
  const assignments = useQuery({ queryKey: ['assignments'], queryFn: () => api.get<Assignment[]>('/assignments') })
  const schools = useQuery({ queryKey: ['schools'], queryFn: () => api.get<SchoolSummary[]>('/schools') })
  const ready = drivers.data && vans.data && assignments.data && schools.data

  const ctx = useMemo<ParseContext | null>(() => {
    if (!ready) return null
    const plateOf = new Map(vans.data!.map((v) => [v.id, v.license_plate]))
    const driverVan: Record<string, string> = {}
    for (const a of assignments.data!) {
      if (isAssignmentActiveToday(a.start_date, a.end_date) && plateOf.has(a.van_id)) driverVan[a.driver_user_id] = plateOf.get(a.van_id)!
    }
    return {
      types,
      drivers: drivers.data!.filter((d) => d.is_active).map((d) => ({ id: d.id, full_name: d.full_name, email: d.email })),
      vans: vans.data!.map((v) => ({ id: v.id, license_plate: v.license_plate, number: v.number })),
      driverVan,
    }
  }, [ready, types, drivers.data, vans.data, assignments.data])

  const [raws, setRaws] = useState<RawSheet[]>([])
  const [fileErrors, setFileErrors] = useState<string[]>([])
  const [overrides, setOverrides] = useState<Record<string, SheetKind>>({})
  const [startDate, setStartDate] = useState(localISODate())
  const [fileKey, setFileKey] = useState(0)
  const [statuses, setStatuses] = useState<Record<string, RowStatus[]> | null>(null)
  const [result, setResult] = useState<{ counts: Record<string, number>; needs: NeedRow[]; credentials: ImportCredential[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const parsed = useMemo<ParsedSheet[]>(() => (ctx ? raws.map((r) => parseSheet(r, ctx, overrides[sheetId(r)])) : []), [raws, ctx, overrides])
  const plan = useMemo(() => (ctx ? buildPlan(parsed, ctx, { startDate, maxRows, knownSchools: (schools.data ?? []).map((s) => s.name) }) : null), [parsed, ctx, startDate, maxRows, schools.data])
  const typeLabel = (id: string) => types.find((t) => t.id === id)?.label ?? id

  function reset() {
    setStatuses(null)
    setResult(null)
    setError(null)
  }

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    reset()
    const files = [...(e.target.files ?? [])]
    const errs: string[] = []
    const all: RawSheet[] = []
    for (const file of files) {
      if (!/\.(csv|xlsx|xls)$/i.test(file.name)) { errs.push(`${file.name}: choose .csv, .xlsx or .xls files.`); continue }
      try { all.push(...(await readWorkbook(file))) } catch { errs.push(`${file.name}: this file could not be read.`) }
    }
    setRaws(all)
    setOverrides({})
    setFileErrors(errs)
  }

  const needs = useMemo<NeedRow[]>(() => (plan ? needsOf(plan, statuses).map(toNeedRow) : []), [plan, statuses])
  const order = plan ? typesToSend(plan) : []

  const check = useMutation({
    mutationFn: () => checkAll(plan!, post),
    onSuccess: (s) => { setError(null); setStatuses(s) },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not check the files.'),
  })

  const commit = useMutation({
    mutationFn: () => commitAll(plan!, statuses!, post),
    onSuccess: (r) => {
      setError(null)
      // Rows the check already listed (never sent) still need the admin, plus what failed now.
      setResult({ counts: r.counts, credentials: r.credentials as ImportCredential[], needs: [...needs, ...r.needs.map(toNeedRow)] })
      queryClient.invalidateQueries()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'The import stopped part way. What was saved stays saved; check again to see the rest.'),
  })

  function startOver() {
    reset()
    setRaws([])
    setOverrides({})
    setFileErrors([])
    setFileKey((k) => k + 1)
  }

  if (!ctx) return <p className="text-[14px] text-muted">Loading your drivers, vans and schools…</p>

  const goodRows = statuses ? Object.values(statuses).flat().filter((s) => s.state === 'ready' || s.state === 'after').length : 0
  const kindOptions: SheetKind[] = ['route', ...(types.map((t) => t.id) as SheetKind[]), 'unreadable']

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>1. Upload your files</CardTitle>
          {raws.length > 0 && <span className="text-[12px] text-muted">{new Set(raws.map((r) => r.file)).size} files · {raws.length} sheets</span>}
        </CardHeader>
        <div className="flex flex-wrap items-end gap-4 px-5 py-4">
          <input
            key={fileKey}
            type="file"
            multiple
            accept={SPREADSHEET_ACCEPT}
            disabled={Boolean(result)}
            onChange={onFiles}
            className="text-[13px] text-ink file:mr-3 file:h-[38px] file:cursor-pointer file:rounded-btn file:border file:border-outline file:bg-outline-bg file:px-3.5 file:text-[13px] file:font-semibold file:text-ink"
          />
          <Field label="New assignments start on" className="w-[200px]">
            <Input type="date" value={startDate} disabled={Boolean(result)} onChange={(e) => { setStartDate(e.target.value); reset() }} />
          </Field>
        </div>
        {fileErrors.length > 0 && <p className="mx-5 mb-4 rounded-row bg-alert-bg px-3 py-2 text-[13px] text-danger-ink">{fileErrors.join(' ')}</p>}
      </Card>

      {parsed.length > 0 && !result && (
        <Card>
          <CardHeader>
            <CardTitle>2. What we found</CardTitle>
            <span className="text-[12px] text-muted">Change anything that is wrong. Nothing is saved yet.</span>
          </CardHeader>
          <ul className="flex flex-col">
            {parsed.map((s, i) => (
              <SheetRow
                key={sheetId(raws[i])}
                sheet={s}
                options={kindOptions}
                onKind={(k) => { setOverrides((o) => ({ ...o, [sheetId(raws[i])]: k })); reset() }}
              />
            ))}
          </ul>
        </Card>
      )}

      {plan && parsed.length > 0 && !result && (
        <Card>
          <CardHeader>
            <CardTitle>3. Check and import</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-4 px-5 py-4">
            <Counts items={Object.keys(plan.rows).map((t) => [typeLabel(t), plan.rows[t].length] as [string, number])} />
            {plan.overLimit.map((o) => (
              <p key={o.type} role="alert" className="rounded-row bg-caution-bg px-3 py-2 text-[13px] text-caution-fg">
                {typeLabel(o.type)}: {o.count} rows, {o.over} over the limit of {o.max}. These are not imported; upload fewer files at once.
              </p>
            ))}
            {!statuses ? (
              <div>
                <Button type="button" disabled={check.isPending || order.length === 0} onClick={() => check.mutate()}>
                  {check.isPending ? 'Checking…' : 'Check everything'}
                </Button>
              </div>
            ) : (
              <>
                <p className="text-[14px] text-ink">
                  {summaryLine(Object.fromEntries(order.map((t) => [typeLabel(t).toLowerCase(), (statuses[t] ?? []).filter((s) => s.state === 'ready' || s.state === 'after').length])), needs.length, 'ready')}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" disabled={commit.isPending || goodRows === 0} onClick={() => commit.mutate()}>
                    {commit.isPending ? 'Importing…' : `Import ${goodRows} row${goodRows === 1 ? '' : 's'}`}
                  </Button>
                  <span className="text-[13px] text-muted">In order: schools, vans, people, students, then assignments.</span>
                </div>
              </>
            )}
            {needs.length > 0 && <NeedsTable rows={needs} />}
          </div>
        </Card>
      )}

      {error && <p className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-danger-ink">{error}</p>}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Done</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={startOver}>Import more files</Button>
          </CardHeader>
          <div className="flex flex-col gap-4 px-5 py-4">
            <p className="text-[15px] font-semibold text-ink">{summaryLine(Object.fromEntries(Object.entries(result.counts).map(([t, n]) => [typeLabel(t).toLowerCase(), n])), result.needs.length)}</p>
            {result.credentials.length > 0 && (
              <CredentialsTable
                creds={result.credentials}
                onDownload={() => downloadCsv('safeturns-import-temporary-passwords.csv', result.credentials, [
                  { key: 'full_name', header: 'Name' }, { key: 'email', header: 'Email' }, { key: 'temporary_password', header: 'Temporary password' },
                ])}
              />
            )}
            {result.needs.length > 0 && <NeedsTable rows={result.needs} />}
          </div>
        </Card>
      )}
    </div>
  )
}

function SheetRow({ sheet, options, onKind }: { sheet: ParsedSheet; options: SheetKind[]; onKind: (k: SheetKind) => void }) {
  const k = sheet.kind.value
  const count = k === 'route' ? `${sheet.lines.length} student${sheet.lines.length === 1 ? '' : 's'}` : k === 'unreadable' ? 'skipped' : `${sheet.records.length} row${sheet.records.length === 1 ? '' : 's'}`
  const mapped = sheet.columns.filter((c) => c.target)
  return (
    <li className="flex flex-col gap-1.5 border-t border-divider px-5 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <span className="text-muted">{sheet.file} &gt; sheet</span>
        <span className="font-semibold text-ink">"{sheet.sheet}"</span>
        <span className="text-muted">&gt;</span>
        <Select aria-label={`What sheet ${sheet.sheet} is`} className="!h-8 !w-auto !py-0 text-[13px]" value={k} onChange={(e) => onKind(e.target.value as SheetKind)}>
          {options.map((o) => <option key={o} value={o}>{o === 'unreadable' ? 'Skip this sheet' : KIND_LABEL[o]}</option>)}
        </Select>
        <span className="text-muted">({count})</span>
      </div>
      <p className="text-[12px] text-muted">{k === 'unreadable' ? 'Skipped: ' : 'Why: '}{sheet.kind.reason}.{sheet.sheetDriver ? ` Driver: ${sheet.sheetDriver.value.full_name}.` : ''}</p>
      {sheet.problems.map((p) => <p key={p} className="text-[12px] text-caution-fg">{p}</p>)}
      {mapped.length > 0 && (
        <details className="text-[12px] text-muted">
          <summary className="cursor-pointer">Columns ({mapped.length} used{sheet.ignored.length ? `, ${sheet.ignored.length} rows ignored` : ''})</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {sheet.columns.map((c) => (
              <li key={c.index}>
                <span className="font-semibold text-ink">{c.header || `(no header, column ${c.index + 1})`}</span>
                {' → '}
                {c.target ? c.target.replace(/_/g, ' ') : 'not used'}
                {c.reason && <span>: {c.reason}</span>}
              </li>
            ))}
            {sheet.ignored.map((r) => <li key={`i${r.line}`}>Line {r.line} ignored: {r.reason}</li>)}
          </ul>
        </details>
      )}
    </li>
  )
}

function NeedsTable({ rows }: { rows: NeedRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[14px] font-semibold text-ink">{rows.length} row{rows.length === 1 ? '' : 's'} need{rows.length === 1 ? 's' : ''} you</div>
      <div className="max-h-[420px] overflow-auto rounded-btn border border-line">
        <table className="w-full text-left text-[13px]">
          <thead className="sticky top-0 bg-surface-2 text-[12px] text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Where</th>
              <th className="px-3 py-2 font-semibold">What</th>
              <th className="px-3 py-2 font-semibold">Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-divider align-top">
                <td className="px-3 py-2 text-muted">{r.where}</td>
                <td className="px-3 py-2 text-ink">{r.what}</td>
                <td className="px-3 py-2 text-ink">{r.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
