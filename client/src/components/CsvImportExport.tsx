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
  const [menuOpen, setMenuOpen] = useState(false)

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

  // Refresh (3b top bar): one ghost "CSV" button; export/import live in its menu, and the
  // import results float under it instead of pushing the top bar around.
  return (
    <div className="relative">
      <Button variant="ghost" disabled={importing} onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
        <span className="material-symbols-outlined !text-[18px]">upload_file</span>
        {importing ? 'Importing…' : 'CSV'}
      </Button>
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
          <div className="absolute top-full right-0 z-40 mt-1 flex w-48 flex-col rounded-btn bg-surface p-1 shadow-drawer">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                handleExport()
              }}
              className="flex h-9 cursor-pointer items-center gap-2 rounded-row px-2.5 text-left text-[13px] text-ink hover:bg-surface-2"
            >
              <span className="material-symbols-outlined !text-[18px] text-muted">download</span>
              Export {entityName.toLowerCase()} CSV
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                fileInputRef.current?.click()
              }}
              className="flex h-9 cursor-pointer items-center gap-2 rounded-row px-2.5 text-left text-[13px] text-ink hover:bg-surface-2"
            >
              <span className="material-symbols-outlined !text-[18px] text-muted">upload</span>
              Import from CSV
            </button>
          </div>
        </>
      )}

      {results && (
        <div className="absolute top-full right-0 z-40 mt-1 w-80 rounded-btn bg-surface p-3 text-[13px] text-ink shadow-drawer">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="font-semibold">
              {succeeded} of {results.length} row{results.length === 1 ? '' : 's'} imported
              {failed > 0 ? `, ${failed} failed` : ''}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setResults(null)}>
              Dismiss
            </Button>
          </div>
          {failed > 0 && (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-[12px] text-alert-fg">
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
