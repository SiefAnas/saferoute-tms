// Just enough Markdown for the legal pages (served by GET /legal/:document): a frontmatter block
// (`key: value` lines between `---`), # / ## / ### headings, paragraphs, `- ` lists, `> ` quotes,
// **bold** and [links](url). Parsed into plain blocks that React renders as elements: no HTML
// string is ever injected, so the files can't smuggle markup into the page. No dependency added.

export interface Frontmatter {
  [key: string]: string
}

export type Inline = { text: string; bold?: boolean; href?: string }

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: Inline[] }
  | { kind: 'paragraph'; text: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'quote'; text: Inline[] }

export function splitFrontmatter(source: string): { meta: Frontmatter; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!m) return { meta: {}, body: source }
  const meta: Frontmatter = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*(.*?)\s*$/.exec(line)
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
  }
  return { meta, body: source.slice(m[0].length) }
}

// **bold** and [text](url). Links only to http(s), mailto or a site path.
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ text: m[1], bold: true })
    else if (/^(https?:|mailto:|\/)/.test(m[3])) out.push({ text: m[2], href: m[3] })
    else out.push({ text: m[2] })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

export function parseMarkdown(body: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: string[] = []
  let quote: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', text: parseInline(para.join(' ')) })
    if (list.length) blocks.push({ kind: 'list', items: list.map(parseInline) })
    if (quote.length) blocks.push({ kind: 'quote', text: parseInline(quote.join(' ')) })
    para = []
    list = []
    quote = []
  }
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (!line) flush()
    else if (h) {
      flush()
      blocks.push({ kind: 'heading', level: h[1].length as 1 | 2 | 3, text: parseInline(h[2]) })
    } else if (/^[-*]\s+/.test(line)) {
      if (para.length || quote.length) flush()
      list.push(line.replace(/^[-*]\s+/, ''))
    } else if (line.startsWith('>')) {
      if (para.length || list.length) flush()
      quote.push(line.replace(/^>\s?/, ''))
    } else {
      if (list.length || quote.length) flush()
      para.push(line)
    }
  }
  flush()
  return blocks
}
