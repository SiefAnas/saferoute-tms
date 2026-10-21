// One spreadsheet reader for every import (.csv, .xlsx, .xls): every cell as text (raw:false),
// dates as dates, first sheet only, headers trimmed, empty rows skipped. SheetJS loads only when a
// file is actually read, so pages with an import button don't download it up front.
import type { RawSheet } from './sheetParse.ts'

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

// Every sheet of a workbook as plain grids of text, blank rows kept (the multi-file import finds
// the header row itself, see sheetParse.ts). Takes the SheetJS module and a read workbook, so a
// Node test can hand it a workbook it built in memory.
type SheetJS = typeof import('xlsx')
export function sheetsFromWorkbook(XLSX: SheetJS, wb: import('xlsx').WorkBook, fileName: string): RawSheet[] {
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]
    if (!ws || !ws['!ref']) return { file: fileName, name, rows: [], firstLine: 1 }
    const grid = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: true })
    return { file: fileName, name, rows: grid.map((r) => r.map((c) => String(c ?? ''))), firstLine: XLSX.utils.decode_range(ws['!ref']).s.r + 1 }
  })
}

export async function readWorkbook(file: File): Promise<RawSheet[]> {
  const XLSX = await import('xlsx')
  const wb = /\.csv$/i.test(file.name) || file.type === 'text/csv'
    ? XLSX.read(await file.text(), { type: 'string', cellDates: true })
    : XLSX.read(await file.arrayBuffer(), { cellDates: true })
  // A CSV has one sheet, named "Sheet1" by SheetJS: name it after the file instead.
  const sheets = sheetsFromWorkbook(XLSX, wb, file.name)
  if (/\.csv$/i.test(file.name) && sheets.length === 1) sheets[0].name = file.name.replace(/\.csv$/i, '')
  return sheets
}

// Header-keyed row objects, the shape the per-page imports read (row['Email'] etc.).
export async function parseSpreadsheetRecords(file: File): Promise<Record<string, string>[]> {
  const { headers, rows } = await parseSpreadsheet(file)
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]]).filter(([h]) => h)))
}
