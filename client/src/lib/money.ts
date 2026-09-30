// Reads a dollar amount typed or exported by a spreadsheet: "12.50", "$12.50", "12,50",
// "$1,234.50", "1.234,50", "12 USD". Returns whole cents, or a reason it can't be read safely.
// Excel currency cells arrive as their formatted text ("$12.50"), and European exports use a
// decimal comma, so both marks are accepted. Anything that could mean two different amounts is
// refused rather than guessed: "1,234" and "1.234" (a thousands separator, or a decimal?), more
// than two decimals, negatives, or any other text.
export type MoneyParse = { ok: true; cents: number } | { ok: false; reason: string }

const PLAIN_EXAMPLE = 'Write it like 12.50.'

export function parseDollarAmount(input: string | null | undefined): MoneyParse {
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, reason: 'The amount is empty.' }
  if (/^\(.*\)$/.test(raw) || raw.includes('-')) return { ok: false, reason: `"${raw}" is negative. A rate must be 0 or more.` }

  // Currency markers at either end: "$12.50", "12.50 $", "USD 12.50", "12.50 usd".
  const s = raw.replace(/^(\$|usd)\s*/i, '').replace(/\s*(\$|usd)$/i, '')
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return { ok: false, reason: `"${raw}" is not an amount. ${PLAIN_EXAMPLE}` }

  const commas = (s.match(/,/g) ?? []).length
  const dots = (s.match(/\./g) ?? []).length
  let whole: string
  let fraction = ''

  if (commas && dots) {
    // Both marks: the last one is the decimal mark, the other groups thousands.
    const decimalMark = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.'
    const groupMark = decimalMark === ',' ? '.' : ','
    const at = s.lastIndexOf(decimalMark)
    if ((s.match(new RegExp(`\\${decimalMark}`, 'g')) ?? []).length > 1) return unclear(raw)
    whole = s.slice(0, at)
    fraction = s.slice(at + 1)
    if (!validGroups(whole, groupMark)) return unclear(raw)
    whole = whole.split(groupMark).join('')
  } else if (commas || dots) {
    const mark = commas ? ',' : '.'
    const count = commas || dots
    const parts = s.split(mark)
    if (count > 1) {
      // "1,234,567" or "1.234.567": only thousands grouping, no decimals.
      if (!validGroups(s, mark)) return unclear(raw)
      whole = parts.join('')
    } else {
      const after = parts[1] ?? ''
      if (after.length === 3) {
        return { ok: false, reason: `"${raw}" could mean ${parts[0]}${after} or ${parts[0]}.${after}. Write it without a thousands separator, like ${parts[0]}${after} or ${parts[0]}.${after.slice(0, 2)}.` }
      }
      whole = parts[0] ?? ''
      fraction = after
    }
  } else {
    whole = s
  }

  if (!whole) whole = '0'
  if (!/^[0-9]+$/.test(whole) || !/^[0-9]*$/.test(fraction)) return unclear(raw)
  if (fraction.length > 2) return { ok: false, reason: `"${raw}" has more than 2 decimals. ${PLAIN_EXAMPLE}` }
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(cents)) return unclear(raw)
  return { ok: true, cents }
}

function unclear(raw: string): MoneyParse {
  return { ok: false, reason: `"${raw}" is not a clear amount. ${PLAIN_EXAMPLE}` }
}

// "1,234,567" style: 1-3 digits, then groups of exactly 3.
function validGroups(value: string, mark: string): boolean {
  const groups = value.split(mark)
  return /^[0-9]{1,3}$/.test(groups[0] ?? '') && groups.slice(1).every((g) => /^[0-9]{3}$/.test(g))
}
