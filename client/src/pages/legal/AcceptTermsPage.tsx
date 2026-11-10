import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Logo } from '../../components/Logo'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { LEGAL_DOCS, useLegalDoc, type LegalDocId } from '../../lib/legal'
import { ROLE_HOME } from '../../lib/roleHome'
import { LegalBlocks } from './LegalPage'

const DOCS: LegalDocId[] = ['terms', 'privacy']

// First sign-in (and whenever a new version is published): the user agrees to the Terms of Use
// and Privacy Policy before using SafeTurns, or signs out. ProtectedRoute sends them here after
// the password change. Both documents are on the page to read and scroll, but the "I agree" bar
// is pinned to the bottom and works right away: nobody has to scroll to the end to reach it.
export function AcceptTermsPage() {
  const { user, token, markLegalAccepted, logout } = useAuth()
  const navigate = useNavigate()
  const terms = useLegalDoc('terms')
  const privacy = useLegalDoc('privacy')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!token || !user) return <Navigate to="/login" replace />
  if (user.must_change_password) return <Navigate to="/set-password" replace />
  if (!user.legal_pending) return <Navigate to={ROLE_HOME[user.role]} replace />

  const docs = { terms: terms.data, privacy: privacy.data }
  const loaded = Boolean(docs.terms && docs.privacy)
  const loadFailed = terms.isError || privacy.isError

  async function agree() {
    if (!docs.terms || !docs.privacy) return
    setError(null)
    setSaving(true)
    try {
      // The versions this screen showed: if a newer one was published meanwhile, the server
      // answers 409 and the user reloads and agrees to that one.
      await api.post('/legal/accept', { terms: docs.terms.version, privacy: docs.privacy.version })
      markLegalAccepted()
      navigate(ROLE_HOME[user!.role], { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your agreement. Please try again.')
      setSaving(false)
    }
  }

  return (
    <main className="flex h-dvh flex-col bg-bg text-ink">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[760px] flex-col gap-2 px-4 py-4">
          <Logo kind="lockup" surface="auto" className="h-7 self-start" />
          <h1 className="text-[20px] font-bold">Before you continue</h1>
          <p className="text-[14px] text-muted">
            Welcome, {user.full_name}. Please review the SafeTurns Terms of Use and Privacy Policy. You need to agree to them to use
            SafeTurns.
          </p>
          <nav className="flex gap-4 text-[13px] font-medium">
            {DOCS.map((id) => (
              <a key={id} href={`#accept-${id}`} className="text-ink underline underline-offset-2">
                {LEGAL_DOCS[id].title}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-4 py-6">
          {DOCS.map((id) => {
            const d = docs[id]
            const q = id === 'terms' ? terms : privacy
            return (
              <article
                key={id}
                id={`accept-${id}`}
                className="flex scroll-mt-4 flex-col gap-4 rounded-card border border-line bg-surface p-5 text-[15px] leading-relaxed text-muted shadow-card md:p-8"
              >
                {d ? (
                  <>
                    <p className="text-[13px]">
                      Version {d.version}
                      {d.effective && <> · effective {d.effective}</>}
                    </p>
                    <LegalBlocks blocks={d.blocks} />
                  </>
                ) : q.isError ? (
                  <p role="alert" className="text-alert-fg">
                    Could not load the {LEGAL_DOCS[id].title}. Check your connection and reload the page.
                  </p>
                ) : (
                  <p>Loading the {LEGAL_DOCS[id].title}…</p>
                )}
              </article>
            )
          })}
        </div>
      </div>

      <footer className="shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-[760px] flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
          <p className="flex-1 text-[13px] text-muted">
            By selecting <strong className="font-semibold text-ink">I agree</strong>, you agree to the SafeTurns Terms of Use
            {docs.terms && <> (v{docs.terms.version})</>} and Privacy Policy{docs.privacy && <> (v{docs.privacy.version})</>}.
          </p>
          {error && (
            <p role="alert" className="text-[13px] text-alert-fg md:hidden">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="lg" className="flex-1 md:flex-none" onClick={logout} disabled={saving}>
              Decline and sign out
            </Button>
            <Button size="lg" className="flex-1 md:flex-none md:px-8" onClick={agree} disabled={!loaded || saving || loadFailed}>
              {saving ? 'Saving…' : 'I agree'}
            </Button>
          </div>
        </div>
        {error && (
          <p role="alert" className="mx-auto hidden max-w-[760px] px-4 pb-3 text-[13px] text-alert-fg md:block">
            {error}
          </p>
        )}
      </footer>
    </main>
  )
}
