import termsSource from '../legal/terms.md?raw'
import privacySource from '../legal/privacy.md?raw'
import { parseMarkdown, splitFrontmatter, type Block } from './markdown'

// The Terms of Use and Privacy Policy, bundled from client/src/legal/*.md. Each file's
// frontmatter carries `version` and `effective`; the signup form sends the versions it showed
// (acceptLegal) and the server records one legal_acceptances row per document.
export type LegalDocId = 'terms' | 'privacy'

export interface LegalDoc {
  id: LegalDocId
  title: string
  path: string
  version: string
  effective: string
  blocks: Block[]
}

function load(id: LegalDocId, title: string, path: string, source: string): LegalDoc {
  const { meta, body } = splitFrontmatter(source)
  return { id, title, path, version: meta.version ?? '', effective: meta.effective ?? '', blocks: parseMarkdown(body) }
}

export const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = {
  terms: load('terms', 'Terms of Use', '/terms', termsSource),
  privacy: load('privacy', 'Privacy Policy', '/privacy', privacySource),
}

// Body for POST /signup/:kind once the checkbox is ticked.
export const LEGAL_ACCEPTANCE = { terms: LEGAL_DOCS.terms.version, privacy: LEGAL_DOCS.privacy.version }
