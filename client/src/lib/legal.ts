import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { parseMarkdown, splitFrontmatter, type Block } from './markdown'

// The Terms of Use and Privacy Policy. The API owns them (server/src/legal, GET /legal/:document);
// the website fetches and renders them. The signup form sends the versions it showed
// (acceptLegal) and the server records one legal_acceptances row per document.
export type LegalDocId = 'terms' | 'privacy'

// Fixed per document: names and paths for links, available before anything is fetched.
export const LEGAL_DOCS: Record<LegalDocId, { id: LegalDocId; title: string; path: string }> = {
  terms: { id: 'terms', title: 'Terms of Use', path: '/terms' },
  privacy: { id: 'privacy', title: 'Privacy Policy', path: '/privacy' },
}

// GET /legal/:document
export interface LegalDocResponse {
  document: LegalDocId
  version: string
  effective: string
  markdown: string
}

export interface LegalDoc extends LegalDocResponse {
  blocks: Block[]
}

export function useLegalDoc(id: LegalDocId) {
  return useQuery({
    queryKey: ['legal', id],
    queryFn: async (): Promise<LegalDoc> => {
      const doc = await api.get<LegalDocResponse>(`/legal/${id}`)
      return { ...doc, blocks: parseMarkdown(splitFrontmatter(doc.markdown).body) }
    },
    staleTime: 10 * 60 * 1000,
  })
}
