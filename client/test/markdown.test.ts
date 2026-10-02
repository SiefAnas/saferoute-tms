// Plain Node test, same style as the others: the tiny Markdown reader behind /privacy and /terms,
// and the real legal files' frontmatter (the versions the signup form sends to the server).
import { readFileSync } from 'node:fs'
import { parseInline, parseMarkdown, splitFrontmatter } from '../src/lib/markdown.ts'

let pass = 0
let fail = 0
function eq(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`) }
}

console.log('--- frontmatter ---')
const fm = splitFrontmatter('---\nversion: 1.2\neffective: "2026-10-02"\n---\n\n# Title\n')
eq('reads key: value lines, strips quotes', fm.meta, { version: '1.2', effective: '2026-10-02' })
eq('body starts after the block', fm.body.trim(), '# Title')
eq('no frontmatter -> empty meta, whole body', splitFrontmatter('# Hi').meta, {})
eq('CRLF files work', splitFrontmatter('---\r\nversion: 3\r\n---\r\nx').meta, { version: '3' })

console.log('--- blocks ---')
const blocks = parseMarkdown('# A\n\nline one\nline two\n\n- x\n- **y**\n\n> note\n> more\n\n## B')
eq('kinds in order', blocks.map((b) => b.kind), ['heading', 'paragraph', 'list', 'quote', 'heading'])
eq('paragraph lines are joined', blocks[1], { kind: 'paragraph', text: [{ text: 'line one line two' }] })
eq('list items, bold inside', blocks[2], { kind: 'list', items: [[{ text: 'x' }], [{ text: 'y', bold: true }]] })
eq('quote lines joined', blocks[3], { kind: 'quote', text: [{ text: 'note more' }] })
eq('heading level', blocks[4].kind === 'heading' && blocks[4].level, 2)

console.log('--- inline ---')
eq('bold + link', parseInline('a **b** [c](/terms) d'), [{ text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', href: '/terms' }, { text: ' d' }])
eq('javascript: links become plain text', parseInline('[x](javascript:alert(1))'), [{ text: 'x' }, { text: ')' }])
eq('raw HTML stays text', parseInline('<b>x</b>'), [{ text: '<b>x</b>' }])

console.log('--- the real legal files ---')
for (const doc of ['terms', 'privacy']) {
  const { meta, body } = splitFrontmatter(readFileSync(new URL(`../src/legal/${doc}.md`, import.meta.url), 'utf8'))
  eq(`${doc}.md has a version`, Boolean(meta.version), true)
  eq(`${doc}.md effective is a date`, /^\d{4}-\d{2}-\d{2}$/.test(meta.effective ?? ''), true)
  eq(`${doc}.md is marked PLACEHOLDER`, body.includes('PLACEHOLDER'), true)
}

console.log(`\n==== markdown: ${pass} passed, ${fail} failed ====`)
if (fail) process.exit(1)
