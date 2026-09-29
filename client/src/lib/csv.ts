import Papa from 'papaparse'

export interface CsvColumn<T> {
  key: string
  header: string
  // How to read this column's value out of a row object for export. Defaults to row[key].
  value?: (row: T) => string | number | null | undefined
}

// Reusable CSV export (2026-08-28 task: "build one reusable CSV helper first, then wire
// into each page"). The exported file doubles as the import template by construction —
// same columns/headers either way, per the task's explicit instruction.
export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]) {
  const csv = Papa.unparse({
    fields: columns.map((c) => c.header),
    data: rows.map((row) => columns.map((c) => (c.value ? c.value(row) : (row as Record<string, unknown>)[c.key]) ?? '')),
  })
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
