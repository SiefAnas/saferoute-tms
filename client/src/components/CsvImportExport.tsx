import { useRef, useState } from 'react'
import { downloadCsv, parseCsvFile, type CsvColumn } from '../lib/csv'
import { Button } from './Button'

export interface CsvRowResult {
  row: number // 1-indexed, matching the row's position in the spreadsheet (header excluded)
  ok: boolean
  message: string
}

// Reusable CSV import/export toolbar (2026-08-28 task) — one component wired into every
// page (Drivers, Fleet, Students, Payroll) rather than repeating this logic per page.
// Import is upsert-style: each row is handed to the page's own onImportRow, which decides
// how to match/create/update (email for people, license plate for vans, etc. — page-
// specific, since the natural key differs per resource). Every row gets its own
// success/failure result, shown after the whole file finishes, so a bad row never silently
// blocks the good ones.
export function CsvImportExport<T>({
  entityName,
  columns,
  rows,
  onImportRow,
  onImportComplete,
}: {
  entityName: string
  columns: CsvColumn<T>[]
  rows: T[]
  onImportRow: (row: Record<string, string>) => Promise<{ ok: boolean; message: string }>
  onImportComplete?: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<CsvRowResult[] | null>(null)

  function handleExport() {
    downloadCsv(`${entityName.toLowerCase().replace(/\s+/g, '-')}.csv`, rows, columns)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setResults(null)
    try {
      const parsedRows = await parseCsvFile(file)
      const rowResults: CsvRowResult[] = []
      for (let i = 0; i < parsedRows.length; i++) {
        try {
          const outcome = await onImportRow(parsedRows[i])
          rowResults.push({ row: i + 1, ...outcome })
        } catch (err) {
          rowResults.push({ row: i + 1, ok: false, message: err instanceof Error ? err.message : 'Unknown error' })
        }
      }
      setResults(rowResults)
      onImportComplete?.()
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const succeeded = results?.filter((r) => r.ok).length ?? 0
  const failed = results?.filter((r) => !r.ok).length ?? 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-9 gap-2 px-4 text-label-md" onClick={handleExport}>
          <span className="material-symbols-outlined !text-[18px]">download</span>
          Export CSV
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-9 gap-2 px-4 text-label-md"
          disabled={importing}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="material-symbols-outlined !text-[18px]">upload</span>
          {importing ? 'Importing…' : 'Import CSV'}
        </Button>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
      </div>

      {results && (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3 text-body-md">
          <div className="mb-1 flex items-center justify-between">
            <p className="font-medium">
              {succeeded} of {results.length} row{results.length === 1 ? '' : 's'} imported
              {failed > 0 ? `, ${failed} failed` : ''}
            </p>
            <button type="button" onClick={() => setResults(null)} className="text-label-md text-secondary hover:underline">
              Dismiss
            </button>
          </div>
          {failed > 0 && (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-label-md text-error">
              {results
                .filter((r) => !r.ok)
                .map((r) => (
                  <li key={r.row}>
                    Row {r.row}: {r.message}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
