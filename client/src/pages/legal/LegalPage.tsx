import { Link } from 'react-router-dom'
import { Copyright } from '../../components/Copyright'
import { Logo } from '../../components/Logo'
import { LEGAL_DOCS, type LegalDocId } from '../../lib/legal'
import type { Inline } from '../../lib/markdown'
import { useAuth } from '../../lib/auth'
import { ROLE_HOME } from '../../lib/roleHome'

function Text({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.href ? (
          p.href.startsWith('/') ? (
            <Link key={i} to={p.href} className="font-medium text-ink underline underline-offset-2">
              {p.text}
            </Link>
          ) : (
            <a key={i} href={p.href} className="font-medium text-ink underline underline-offset-2" rel="noreferrer">
              {p.text}
            </a>
          )
        ) : p.bold ? (
          <strong key={i} className="font-semibold text-ink">
            {p.text}
          </strong>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

// Public /terms and /privacy: no sign-in needed (linked from login, register and the app).
export function LegalPage({ doc }: { doc: LegalDocId }) {
  const d = LEGAL_DOCS[doc]
  const other = LEGAL_DOCS[doc === 'terms' ? 'privacy' : 'terms']
  const { user, token } = useAuth()
  const back = token && user ? { to: ROLE_HOME[user.role], label: 'Back to SafeTurns' } : { to: '/login', label: 'Back to sign in' }
  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-4 py-8 md:py-12">
        <div className="flex items-center justify-between gap-4">
          <Logo kind="lockup" surface="auto" className="h-8" />
          <Link to={back.to} className="text-[13px] font-medium text-muted hover:text-ink hover:underline">
            {back.label}
          </Link>
        </div>
        <article className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6 text-[15px] leading-relaxed text-muted shadow-card md:p-10">
          <p className="text-[13px]">
            Version {d.version}
            {d.effective && <> · effective {d.effective}</>}
          </p>
          {d.blocks.map((b, i) => {
            if (b.kind === 'heading') {
              const cls = b.level === 1 ? 'text-[26px] font-bold text-ink' : b.level === 2 ? 'pt-2 text-[18px] font-semibold text-ink' : 'text-[15px] font-semibold text-ink'
              const H = (`h${b.level}` as 'h1' | 'h2' | 'h3')
              return (
                <H key={i} className={cls}>
                  <Text parts={b.text} />
                </H>
              )
            }
            if (b.kind === 'list')
              return (
                <ul key={i} className="flex list-disc flex-col gap-1 pl-6">
                  {b.items.map((it, j) => (
                    <li key={j}>
                      <Text parts={it} />
                    </li>
                  ))}
                </ul>
              )
            if (b.kind === 'quote')
              return (
                <blockquote key={i} className="rounded-row border-l-4 border-amber bg-caution-bg px-4 py-3 text-caution-fg">
                  <Text parts={b.text} />
                </blockquote>
              )
            return (
              <p key={i}>
                <Text parts={b.text} />
              </p>
            )
          })}
        </article>
        <Link to={other.path} className="text-[13px] font-medium text-muted hover:text-ink hover:underline">
          Read the {other.title}
        </Link>
      </div>
      <Copyright />
    </main>
  )
}
