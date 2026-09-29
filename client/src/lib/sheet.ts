// One spreadsheet reader for every import (.csv, .xlsx, .xls): every cell as text (raw:false),
// dates as dates, first sheet only, headers trimmed, empty rows skipped. SheetJS loads only when a
// file is actually read, so pages with an import button don't download it up front.
export interface ParsedSheet {
  headers: string[]
  rows: string[][] // data rows as uploaded, one string per header column
  rowNumbers: number[] // each data row's line number in the spreadsheet
}

export const SPREADSHEET_ACCEPT = '.csv,.xlsx,.xls,text/csv'

export async function parseSpreadsheet(file: File): Promise<ParsedSheet> {
  const XLSX = await import('xlsx')
  // CSV is decoded here as UTF-8: handed raw bytes, SheetJS reads a CSV without a BOM as Latin-1.
  const wb = /\.csv$/i.test(file.name) || file.type === 'text/csv'
    ? XLSX.read(await file.text(), { type: 'string', cellDates: true })
    : XLSX.read(await file.arrayBuffer(), { cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return { headers: [], rows: [], rowNumbers: [] }
  // Blank rows are kept here (and skipped below) so each row's line number is known.
  const all = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: true })
  const firstLine = XLSX.utils.decode_range(ws['!ref'] ?? 'A1').s.r + 1
  const [head, ...body] = all
  const headers = (head ?? []).map((h) => String(h ?? '').trim())
  const rows: string[][] = []
  const rowNumbers: number[] = []
  body.forEach((r, i) => {
    const cells = headers.map((_, c) => String(r[c] ?? ''))
    if (!cells.some((c) => c.trim() !== '')) return
    rows.push(cells)
    rowNumbers.push(firstLine + 1 + i)
  })
  return { headers, rows, rowNumbers }
}

// Header-keyed row objects, the shape the per-page imports read (row['Email'] etc.).
export async function parseSpreadsheetRecords(file: File): Promise<Record<string, string>[]> {
  const { headers, rows } = await parseSpreadsheet(file)
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]]).filter(([h]) => h)))
}
