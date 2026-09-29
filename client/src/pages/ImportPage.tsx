import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { api, ApiError } from '../lib/api'
import { downloadCsv } from '../lib/csv'
import { Button } from '../components/Button'
import { Card, CardHeader, CardTitle } from '../components/Card'
import { Field, Select } from '../components/Input'
import { PageIntro } from '../components/Records'
import { PageTopBar } from '../layouts/TopBar'
import type { ImportCommitResult, ImportCredential, ImportPreview, ImportTypesResponse } from '../types/api'

// Bulk import (docs/bulk-import-spec.md), web only. One screen, four steps: pick what you are
// importing, upload and match columns, preview every row (nothing saved), then import. The file is
// read here; the server checks every row again on import, so preview and import can't disagree.

interface Sheet {
  fileName: string
  headers: string[]
  rows: string[][] // the data rows exactly as uploaded, one string per column
  rowNumbers: number[] // each data row's line number in the spreadsheet, for messages
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Every cell as text (raw:false), dates as dates, first sheet only, trimmed headers, empty rows skipped.
async function readSheet(file: File): Promise<Sheet> {
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('This file has no sheets.')
  // Blank rows are kept here (and skipped below) so each row's spreadsheet line number is known.
  const all = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: true })
  const firstLine = XLSX.utils.decode_range(ws['!ref'] ?? 'A1').s.r + 1
  const [head, ...body] = all
  const headers = (head ?? []).map((h) => String(h ?? '').trim())
  if (!headers.some(Boolean)) throw new Error('This file has no header row. The first row must name the columns, like "Full name" and "Email".')
  const rows: string[][] = []
  const rowNumbers: number[] = []
  body.forEach((r, i) => {
    const cells = headers.map((_, c) => String(r[c] ?? ''))
    if (!cells.some((c) => c.trim() !== '')) return
    rows.push(cells)
    rowNumbers.push(firstLine + 1 + i)
  })
  if (rows.length === 0) throw new Error('This file has a header row but no data rows.')
  return { fileName: file.name, headers, rows, rowNumbers }
}

const ACTION_TEXT = { create: 'Will create', update: 'Will update', error: 'Error' } as const
const ACTION_CLASS = { create: 'text-success-fg', update: 'text-ink', error: 'text-danger-ink' } as const

export function ImportPage() {
  const queryClient = useQueryClient()
  const typesQuery = useQuery({ queryKey: ['import-types'], queryFn: () => api.get<ImportTypesResponse>('/imports/types') })
  const types = typesQuery.data?.types ?? []
  const maxRows = typesQuery.data?.max_rows ?? 100

  const [typeId, setTypeId] = useState('')
  const type = types.find((t) => t.id === typeId)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportCommitResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileKey, setFileKey] = useState(0)

  const savedMapping = useQuery({
    queryKey: ['import-mapping', typeId],
    queryFn: () => api.get<{ mapping: Record<string, string> | null }>(`/imports/mapping?type=${encodeURIComponent(typeId)}`),
    enabled: Boolean(typeId),
  })

  // Pre-fill the column matches: the company's saved choice first, then a column with the same name.
  useEffect(() => {
    if (!type || !sheet) return
    const saved = savedMapping.data?.mapping ?? {}
    const next: Record<string, string> = {}
    for (const f of type.fields) {
      if (saved[f.key] && sheet.headers.includes(saved[f.key])) next[f.key] = saved[f.key]
      else next[f.key] = sheet.headers.find((h) => h && (norm(h) === norm(f.key) || norm(h) === norm(f.label))) ?? ''
    }
    setMapping(next)
  }, [type, sheet, savedMapping.data])

  function resetAfter(step: 'type' | 'file') {
    setPreview(null)
    setResult(null)
    setError(null)
    if (step === 'type') {
      setSheet(null)
      setFileError(null)
      setFileKey((k) => k + 1)
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    resetAfter('file')
    setSheet(null)
    setFileError(null)
    const file = e.target.files?.[0]
    if (!file) return
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
      setFileError('Choose a .csv, .xlsx or .xls file.')
      return
    }
    try {
      const s = await readSheet(file)
      if (s.rows.length > maxRows) {
        setFileError(`This file has ${s.rows.length} rows. The limit is ${maxRows} per file. Split it into smaller files and upload them one at a time.`)
        return
      }
      setSheet(s)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'This file could not be read.')
    }
  }

  const mappedRows = useMemo(() => {
    if (!sheet || !type) return []
    return sheet.rows.map((r) => {
      const out: Record<string, string> = {}
      for (const f of type.fields) {
        const col = mapping[f.key]
        out[f.key] = col ? r[sheet.headers.indexOf(col)] ?? '' : ''
      }
      return out
    })
  }, [sheet, type, mapping])

  const unmappedRequired = type?.fields.filter((f) => f.required && !mapping[f.key]) ?? []

  const runPreview = useMutation({
    mutationFn: async () => {
      await api.put('/imports/mapping', { type: typeId, mapping })
      return api.post<ImportPreview>('/imports/preview', { type: typeId, rows: mappedRows })
    },
    onSuccess: (p) => {
      setError(null)
      setPreview(p)
      queryClient.invalidateQueries({ queryKey: ['import-mapping', typeId] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not check the file.'),
  })

  const runCommit = useMutation({
    mutationFn: () => api.post<ImportCommitResult>('/imports/commit', { type: typeId, rows: mappedRows }),
    onSuccess: (r) => {
      setError(null)
      setResult(r)
      setPreview(null)
      queryClient.invalidateQueries()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'The import did not finish. Nothing was lost; preview again to see what was saved.'),
  })

  function downloadErrors() {
    if (!sheet || !result) return
    const bad = result.rows.filter((r) => r.status === 'error')
    const csv = Papa.unparse({ fields: [...sheet.headers, 'Error'], data: bad.map((r) => [...sheet.rows[r.index], r.reason ?? '']) })
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${sheet.fileName.replace(/\.[^.]+$/, '')}-errors.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadCredentials(creds: ImportCredential[]) {
    downloadCsv(`safeturns-${typeId}-temporary-passwords.csv`, creds, [
      { key: 'full_name', header: 'Name' },
      { key: 'email', header: 'Email' },
      { key: 'temporary_password', header: 'Temporary password' },
    ])
  }

  function startOver() {
    setTypeId('')
    resetAfter('type')
  }

  const step = result ? 4 : preview ? 3 : sheet && type ? 2 : 1

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="Import" subtitle={`Step ${step} of 4`} />
      <PageIntro>
        Add or update many records at once from a spreadsheet (.csv, .xlsx or .xls, up to {maxRows} rows). Rows are matched by email
        (by license plate for vans), so importing the same file twice updates instead of duplicating. Importing never deactivates anyone.
      </PageIntro>

      <Card>
        <CardHeader>
          <CardTitle>1. What are you importing?</CardTitle>
        </CardHeader>
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <Field label="Import type" className="min-w-[240px]">
            <Select
              value={typeId}
              disabled={Boolean(result)}
              onChange={(e) => {
                setTypeId(e.target.value)
                resetAfter('type')
              }}
            >
              <option value="">Choose…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          {type && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => downloadCsv(`safeturns-${type.id}-template.csv`, [], type.fields.map((f) => ({ key: f.key, header: f.label })))}
            >
              <span className="material-symbols-outlined !text-[18px]">download</span>
              Blank template
            </Button>
          )}
        </div>
      </Card>

      {type && !result && (
        <Card>
          <CardHeader>
            <CardTitle>2. Upload and match columns</CardTitle>
            {sheet && <span className="text-[12px] text-muted">{sheet.fileName} · {sheet.rows.length} rows</span>}
          </CardHeader>
          <div className="flex flex-col gap-4 px-5 py-4">
            <input
              key={fileKey}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={onFile}
              className="text-[13px] text-ink file:mr-3 file:h-[38px] file:cursor-pointer file:rounded-btn file:border file:border-outline file:bg-outline-bg file:px-3.5 file:text-[13px] file:font-semibold file:text-ink"
            />
            {fileError && <p className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-danger-ink">{fileError}</p>}
            {sheet && (
              <>
                <p className="text-[13px] text-muted">Pick which column of your file holds each SafeTurns field. Your choices are remembered for next time.</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {type.fields.map((f) => (
                    <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}>
                      <Select
                        value={mapping[f.key] ?? ''}
                        onChange={(e) => {
                          setMapping((m) => ({ ...m, [f.key]: e.target.value }))
                          setPreview(null)
                        }}
                      >
                        <option value="">Not in this file</option>
                        {sheet.headers.filter(Boolean).map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </div>
                <p className="text-[12px] text-muted">* needed to create a new record. Updates only change the fields that have a value.</p>
                {unmappedRequired.length > 0 && (
                  <p className="text-[13px] text-caution-fg">Not matched yet: {unmappedRequired.map((f) => f.label).join(', ')}. New records will show an error for these.</p>
                )}
                <div>
                  <Button type="button" variant={preview ? 'outline' : 'primary'} disabled={runPreview.isPending} onClick={() => runPreview.mutate()}>
                    {runPreview.isPending ? 'Checking…' : preview ? 'Check again' : 'Preview'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {error && <p className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-danger-ink">{error}</p>}

      {preview && sheet && type && (
        <Card>
          <CardHeader>
            <CardTitle>3. Preview</CardTitle>
            <span className="text-[12px] text-muted">Nothing has been saved yet</span>
          </CardHeader>
          <div className="flex flex-col gap-4 px-5 py-4">
            <Counts items={[['Will create', preview.counts.create], ['Will update', preview.counts.update], ['Errors (not imported)', preview.counts.error]]} />
            <RowTable
              type={type}
              rows={mappedRows}
              rowNumbers={sheet.rowNumbers}
              status={preview.rows.map((r) => ({ label: ACTION_TEXT[r.action], cls: ACTION_CLASS[r.action], reason: r.reason ?? r.note }))}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={runCommit.isPending || preview.counts.create + preview.counts.update === 0} onClick={() => runCommit.mutate()}>
                {runCommit.isPending ? 'Importing…' : `Import ${preview.counts.create + preview.counts.update} good row${preview.counts.create + preview.counts.update === 1 ? '' : 's'}`}
              </Button>
              {preview.counts.error > 0 && <span className="text-[13px] text-muted">Rows with errors are skipped. Fix them in your file and import it again.</span>}
            </div>
          </div>
        </Card>
      )}

      {result && sheet && type && (
        <Card>
          <CardHeader>
            <CardTitle>4. Done</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={startOver}>
              Import another file
            </Button>
          </CardHeader>
          <div className="flex flex-col gap-4 px-5 py-4">
            <Counts items={[['Created', result.counts.created], ['Updated', result.counts.updated], ['Not imported', result.counts.error]]} />
            {result.counts.error > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={downloadErrors}>
                  <span className="material-symbols-outlined !text-[18px]">download</span>
                  Download error file
                </Button>
                <span className="text-[13px] text-muted">Your original rows, exactly as uploaded, plus the reason. Fix them and import that file.</span>
              </div>
            )}
            {result.credentials.length > 0 && <CredentialsTable creds={result.credentials} onDownload={() => downloadCredentials(result.credentials)} />}
            <RowTable
              type={type}
              rows={mappedRows}
              rowNumbers={sheet.rowNumbers}
              status={result.rows.map((r) => ({
                label: r.status === 'created' ? 'Created' : r.status === 'updated' ? 'Updated' : 'Not imported',
                cls: r.status === 'error' ? 'text-danger-ink' : 'text-success-fg',
                reason: r.reason,
              }))}
            />
          </div>
        </Card>
      )}
    </div>
  )
}

function Counts({ items }: { items: [string, number][] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {items.map(([label, n]) => (
        <div key={label} className="min-w-[130px] rounded-btn border border-line px-4 py-2.5">
          <div className="text-[22px] font-semibold text-ink">{n}</div>
          <div className="text-[12px] text-muted">{label}</div>
        </div>
      ))}
    </div>
  )
}

function RowTable({
  type,
  rows,
  rowNumbers,
  status,
}: {
  type: ImportTypesResponse['types'][number]
  rows: Record<string, string>[]
  rowNumbers: number[]
  status: { label: string; cls: string; reason: string | null | undefined }[]
}) {
  const shown = type.fields.slice(0, 3)
  return (
    <div className="max-h-[420px] overflow-auto rounded-btn border border-line">
      <table className="w-full text-left text-[13px]">
        <thead className="sticky top-0 bg-surface-2 text-[12px] text-muted">
          <tr>
            <th className="px-3 py-2 font-semibold">Row</th>
            {shown.map((f) => (
              <th key={f.key} className="px-3 py-2 font-semibold">
                {f.label}
              </th>
            ))}
            <th className="px-3 py-2 font-semibold">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-divider align-top">
              <td className="px-3 py-2 text-muted">{rowNumbers[i]}</td>
              {shown.map((f) => (
                <td key={f.key} className="max-w-[220px] truncate px-3 py-2 text-ink">
                  {r[f.key]}
                </td>
              ))}
              <td className="px-3 py-2">
                <span className={`font-semibold ${status[i]?.cls ?? ''}`}>{status[i]?.label}</span>
                {status[i]?.reason && <div className="text-[12px] text-muted">{status[i].reason}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CredentialsTable({ creds, onDownload }: { creds: ImportCredential[]; onDownload: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-btn border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[14px] font-semibold text-ink">New accounts and their temporary passwords</div>
        <Button type="button" onClick={onDownload}>
          <span className="material-symbols-outlined !text-[18px]">download</span>
          Download
        </Button>
      </div>
      <p className="rounded-row bg-caution-bg px-3 py-2 text-[13px] text-caution-fg">
        Shown only now. Download or copy this list before leaving the page. Each person signs in with their email and this password,
        then chooses their own. Passwords expire after 7 days. If the list is lost, use Reset password on the person's account.
      </p>
      <div className="max-h-[320px] overflow-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="text-[12px] text-muted">
            <tr>
              <th className="py-1.5 pr-3 font-semibold">Name</th>
              <th className="py-1.5 pr-3 font-semibold">Email</th>
              <th className="py-1.5 font-semibold">Temporary password</th>
            </tr>
          </thead>
          <tbody>
            {creds.map((c) => (
              <tr key={c.email} className="border-t border-divider">
                <td className="py-1.5 pr-3 text-ink">{c.full_name}</td>
                <td className="py-1.5 pr-3 text-ink">{c.email}</td>
                <td className="py-1.5 font-mono font-semibold text-ink select-all">{c.temporary_password}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
